package api

import (
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	co "openai-api-proxy/costs"
	db "openai-api-proxy/db"
	"sort"
	"strings"
	"time"

	"github.com/go-echarts/go-echarts/v2/charts"
	"github.com/go-echarts/go-echarts/v2/opts"
)

type GraphHandler struct {
	a     *ApiHandler
	cache []Cache
	// Per-model cost rows cache to avoid repeated DB lookups while resolving per-request costs.
	costsCache map[string][]db.Costs
}

// if basecount, filter and DB Rows missmatch, Cache will be updated
type Cache struct {
	ID        string
	BaseCount int //
	Filter    string
	Unit      string
	Data      []db.RequestSummary
}

func NewGraphHandler(a *ApiHandler) *GraphHandler {
	var cache []Cache
	return &GraphHandler{a, cache, make(map[string][]db.Costs)}
}

// Generate Token Graphs for API Key and Admin overview and allow to filter by timeframes

type Graph struct {
	unit               string
	filter             string
	overwriteDateTrunc bool
	key                string
	kind               string // can be "user" or "apiKey"
	w                  http.ResponseWriter
	r                  *http.Request
}

func (g *GraphHandler) GetTableGraph(w http.ResponseWriter, r *http.Request) {
	ok := g.a.auth.ValidateSessionToken(w, r)
	if !ok {
		http.Error(w, "Not Authorized", http.StatusForbidden)
		return
	}
	key := strings.TrimPrefix(r.URL.Path, "/api2/table/graph/get/")
	g.RenderGraph(&Graph{
		key:  key,
		kind: "apiKey",
		w:    w,
		r:    r,
	})

}

func (g *GraphHandler) GetAdminTableGraph(w http.ResponseWriter, r *http.Request) {

	ok, err := g.a.auth.ValidateAdminSession(w, r)
	if err != nil || !ok {
		http.Error(w, "Not Authorized", http.StatusForbidden)
		return
	}

	key := strings.TrimPrefix(r.URL.Path, "/api2/admin/table/graph/get/")
	g.RenderGraph(&Graph{
		key:  key,
		kind: "user",
		w:    w,
		r:    r,
	})

}
func getFilterMap() map[string]string {
	return map[string]string{
		"24h":        "24 Hours",
		"7d":         "7 days",
		"30d":        "30 days",
		"this-month": "This Month",
		"last-month": "Last Month",
		"last-year":  "Last Year",
		"this-year":  "This Year",
	}
}

func (gr *Graph) setFilter(r *http.Request) {
	selectedfilter := "24h" // default Value
	header := r.Header.Get("HX-Current-URL")
	currentURL, err := url.Parse(header)
	if err != nil {
		log.Println("Error Parsing HX-Current-URL for Graph Table")
	}

	params, err := url.ParseQuery(currentURL.RawQuery)
	paramFilter := params.Get("filter")
	if err == nil && paramFilter != "" {
		selectedfilter = paramFilter
	}

	// Use Map for Sanitization of upcoming SQL Statement and simpler querys in Web UI
	filter, ok := getFilterMap()[selectedfilter]
	if !ok {
		filter = "24 Hours"
	}
	gr.filter = filter
}

func getUnits() map[string]string {
	return map[string]string{
		"tokens": "Tokens",
		"EUR":    "€",
	}
}

func (gr *Graph) setUnit() {
	header := gr.r.Header.Get("HX-Current-URL")
	currentURL, err := url.Parse(header)
	if err != nil {
		log.Println("Error Parsing HX-Current-URL for Graph Table")
	}

	params, err := url.ParseQuery(currentURL.RawQuery)
	paramFilter := params.Get("unit")
	var selectedUnit string
	if _, ok := getUnits()[paramFilter]; ok && err == nil {
		selectedUnit = paramFilter
	} else {
		selectedUnit = "tokens"
	}
	gr.unit = selectedUnit
}

func (g *GraphHandler) RenderGraph(gr *Graph) {
	gr.setFilter(gr.r)
	gr.setUnit()

	// create a new line instance
	line := charts.NewLine()
	// set some global options like Title/Legend/ToolTip or anything else
	line.SetGlobalOptions(
		charts.WithColorsOpts(opts.Colors{"white"}),
		charts.WithGridOpts(opts.Grid{Width: "335px", Height: "70px", Left: "40px", Top: "6px", Bottom: "0px"}),
		charts.WithInitializationOpts(opts.Initialization{Width: "335px", Height: "100px"}),
		charts.WithLegendOpts(opts.Legend{Show: opts.Bool(false)}),
		charts.WithYAxisOpts(opts.YAxis{SplitNumber: 2}),
		// charts.WithVisualMapOpts(opts.VisualMap{Show: opts.Bool(false)})
	)
	td, err := g.TableGraphDataHandler(gr)
	if err != nil {
		return
	}

	line.SetXAxis(td.timeAxis).
		AddSeries(fmt.Sprintf("%s", gr.filter), td.data)
	// Where the magic happens
	chartSnippet := line.RenderSnippet()

	tmpl := "{{.Element}} <div class=\"content-center -ml-4 w-96 text-center text-xs grid\" ><i>{{.Filter}}: {{if .Estimated}}~{{end}}{{.TotalCount}} {{.Unit}}</i> </div> {{.Script}}"
	t := template.New("snippet")
	t, err = t.Parse(tmpl)
	if err != nil {
		log.Println("error templating", err)

	}
	snippetData := struct {
		Element    template.HTML
		Script     template.HTML
		Option     template.HTML
		TotalCount string
		Unit       string
		Filter     string
		Estimated  bool
	}{
		Element:    template.HTML(chartSnippet.Element),
		Script:     template.HTML(chartSnippet.Script),
		Option:     template.HTML(chartSnippet.Option),
		TotalCount: td.totalCount,
		Filter:     gr.filter,
		Estimated:  td.isEstimated,
		Unit:       getUnits()[gr.unit],
	}
	if err := t.Execute(gr.w, snippetData); err != nil {
		log.Println("Error Templating Chart", err)
		return
	}
}

// This handles the request and the formatting of the data
func (g *GraphHandler) TableGraphDataHandler(gr *Graph) (*TableData, error) {

	gr.overwriteDateTrunc = false

	if gr.unit != "tokens" {
		gr.overwriteDateTrunc = true
	}

	data := g.GetTableGraphData(gr)
	// Put data into instance
	td, err := g.SetTableGraphData(gr, data)
	if err != nil {
		return nil, err
	}
	return td, nil
}

type TableData struct {
	data        []opts.LineData
	timeAxis    []string
	totalCount  string
	isEstimated bool
}

// Get Data from Cache and trigger lookup from db
func (g *GraphHandler) GetTableGraphData(gr *Graph) []db.RequestSummary {
	for _, row := range g.cache {
		if row.ID == gr.key && row.Filter == gr.filter && gr.unit == row.Unit {
			count, err := g.a.db.LookupApiKeyUserStatsRows(gr.key, gr.kind)
			if err == nil && count == row.BaseCount {
				return row.Data
			}
			if err != nil {
				log.Println(err)
			}
			row.Data = g.LookupTableGraphData(gr)
			row.BaseCount = count
			return row.Data
		}
	}
	rowCount, err := g.a.db.LookupApiKeyUserStatsRows(gr.key, gr.kind)
	if err != nil {
		log.Println("could not count rows for caching: ", err)
	}

	row := Cache{
		Data:      g.LookupTableGraphData(gr),
		BaseCount: rowCount,
		Filter:    gr.filter,
		ID:        gr.key,
	}
	g.cache = append(g.cache, row)
	return row.Data
}

// lookup Data in DB
func (g *GraphHandler) LookupTableGraphData(gr *Graph) []db.RequestSummary {
	// Tokens graphs are allowed to use aggregated token totals.
	if !gr.overwriteDateTrunc {
		data, err := g.a.db.LookupApiKeyUserStats(gr.key, gr.kind, gr.filter, gr.overwriteDateTrunc)
		if err != nil && data != nil {
			log.Println(err)
			http.Error(gr.w, "Could not get Data from DB for User "+string(gr.key), 500)
			return nil
		}
		return data
	}

	// Cost graphs must be resolved per request so stage selection can use request.input_token_count.
	requestRows, err := g.a.db.LookupApiKeyUserRequests(gr.key, gr.kind, gr.filter)
	if err != nil {
		log.Println(err)
		http.Error(gr.w, "Could not get Data from DB for User "+string(gr.key), 500)
		return nil
	}

	tm := db.GetFilterTruncMap()
	granularity := tm[gr.filter]
	if granularity == "" {
		// Default to day buckets for filters that are not explicitly listed.
		granularity = "day"
	}

	dates := make(map[time.Time]db.RequestSummary)

	for i, entry := range requestRows {
		entry.Cost, entry.IsEstimated = g.GetCost(entry)

		y, m, d := entry.RequestTime.Date()
		var timeRange time.Time
		switch granularity {
		case "hour":
			timeRange = time.Date(y, m, d, entry.RequestTime.Hour(), 0, 0, 0, time.UTC)
		case "day":
			timeRange = time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
		case "month":
			timeRange = time.Date(y, m, 0, 0, 0, 0, 0, time.UTC)
		default:
			timeRange = time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
		}

		// Ensure the chart axis uses the bucket boundary, not the raw request timestamp.
		entry.RequestTime = timeRange

		if existing, ok := dates[timeRange]; !ok || existing.ID == "" {
			dates[timeRange] = entry
			continue
		}

		trunced := dates[timeRange]
		bigT := trunced.Cost * co.MoneyUnit
		bigE := entry.Cost * co.MoneyUnit
		bigMoney := bigE + bigT
		trunced.Cost = bigMoney / co.MoneyUnit
		trunced.IsEstimated = trunced.IsEstimated || entry.IsEstimated
		dates[timeRange] = trunced

		log.Printf("Entry %v", i)
	}

	costData := make([]db.RequestSummary, 0, len(dates))
	for _, trunced := range dates {
		costData = append(costData, trunced)
	}
	sort.Slice(costData, func(i, j int) bool {
		return costData[i].RequestTime.Before(costData[j].RequestTime)
	})
	return costData
}
func (g *GraphHandler) GetCost(row db.RequestSummary) (float64, bool) {

	value, isEstimated := g.getCostData(row)
	cost := float64(value) / co.MoneyUnit
	return cost, isEstimated
}

func (g *GraphHandler) SetTableGraphData(gr *Graph, d []db.RequestSummary) (*TableData, error) {

	td := &TableData{
		data:     make([]opts.LineData, 0),
		timeAxis: make([]string, 0),
	}

	format := "15:04"

	switch gr.filter {
	case "24 Hours":
		format = "15:04"

	case "7 days":
		format = "Mon"
	case "Last Month", "This Month", "30 days":
		format = "02"
	case "Last Year", "This Year":
		format = "Jan"
	}

	if len(d) < 1 {
		http.Error(gr.w, "&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;No Data", 200)
		err := errors.New("data for Key is Empty")
		return nil, err
	}

	var value int
	var totalcount int

	for _, item := range d {

		var displayValue interface{}

		if gr.overwriteDateTrunc {
			displayValue = item.Cost
			value = int(item.Cost * co.MoneyUnit)
			if item.IsEstimated {
				td.isEstimated = item.IsEstimated
			}
		} else {
			value = item.TokenCountComplete + item.TokenCountPrompt
			displayValue = value
		}

		td.data = append(td.data, opts.LineData{Value: displayValue})
		totalcount = totalcount + value
		loc, err := time.LoadLocation(g.a.timeZone)
		if err != nil {
			log.Println("Error Displaying Timezone, maybe the TIMEZONE env is wrongly set")
			td.timeAxis = append(td.timeAxis, item.RequestTime.Format(format))
			continue
		}
		localTime := item.RequestTime.In(loc)
		td.timeAxis = append(td.timeAxis, localTime.Format(format))

	}

	if gr.overwriteDateTrunc {
		val := float64(totalcount) / co.MoneyUnit
		td.totalCount = fmt.Sprintf("%.4f", val)
	} else {
		td.totalCount = fmt.Sprintf("%v", totalcount)
	}
	return td, nil
}

func (g *GraphHandler) getCostData(dbs db.RequestSummary) (totalCosts int, estimated bool) {
	// Delegate to helper so tests can invoke the same logic without DB access.
	costs, ok := g.costsCache[dbs.Model]
	if !ok {
		costs = g.a.db.LookupCosts(dbs.Model)
		g.costsCache[dbs.Model] = costs
	}
	return computeCosts(costs, dbs)
}

// computeCosts computes the total cost (in smallest money unit) for a request
// given a list of recorded costs.
func computeCosts(costs []db.Costs, dbs db.RequestSummary) (totalCosts int, estimated bool) {
	inputTokenCount := dbs.InputTokenCount
	cachedInputTokenCount := dbs.CachedInputTokenCount
	cacheWriteTokenCount := dbs.CacheWriteTokenCount
	outputTokenCount := dbs.OutputTokenCount

	// Legacy fallback: graph code historically used TokenCountPrompt/TokenCountComplete.
	// When per-request input/cached/output counts aren't populated, treat prompt as full input and cached as 0.
	if inputTokenCount == 0 && cachedInputTokenCount == 0 && outputTokenCount == 0 {
		inputTokenCount = dbs.TokenCountPrompt
		cachedInputTokenCount = 0
		cacheWriteTokenCount = 0
		outputTokenCount = dbs.TokenCountComplete
	}

	res := db.ResolveRequestCostStage(costs, db.RequestCostStageResolutionRequest{
		Model:                 dbs.Model,
		RequestTime:           dbs.RequestTime,
		InputTokenCount:       inputTokenCount,
		CachedInputTokenCount: cachedInputTokenCount,
		CacheWriteTokenCount:  cacheWriteTokenCount,
		OutputTokenCount:      outputTokenCount,
		StageType:             db.ContextLengthStageType,
	})

	if res.Missing {
		return 0, true
	}
	return int(res.TotalCost * float64(co.MoneyUnit)), false
}
