package api

import (
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	db "openai-api-proxy/db"
	"strings"
	"time"

	"github.com/go-echarts/go-echarts/v2/charts"
	"github.com/go-echarts/go-echarts/v2/opts"
)

type Graph struct {
	key  string
	kind string // can be "user" or "apiKey"
	w    http.ResponseWriter
	r    *http.Request
}

func (a *ApiHandler) GetTableGraph(w http.ResponseWriter, r *http.Request) {
	ok := a.auth.ValidateSessionToken(w, r)
	if !ok {
		http.Error(w, "Not Authorized", http.StatusForbidden)
		return
	}
	key := strings.TrimPrefix(r.URL.Path, "/api2/table/graph/get/")
	a.RenderGraph(&Graph{
		key:  key,
		kind: "apiKey",
		w:    w,
		r:    r,
	})

}

func (a *ApiHandler) GetAdminTableGraph(w http.ResponseWriter, r *http.Request) {

	ok, err := a.auth.ValidateAdminSession(w, r)
	if err != nil || !ok {
		http.Error(w, "Not Authorized", http.StatusForbidden)
		return
	}

	key := strings.TrimPrefix(r.URL.Path, "/api2/admin/table/graph/get/")
	a.RenderGraph(&Graph{
		key:  key,
		kind: "user",
		w:    w,
		r:    r,
	})

}

func (a *ApiHandler) RenderGraph(g *Graph) {

	selectedfilter := "24h" // default Value
	header := g.r.Header.Get("HX-Current-URL")
	currentURL, err := url.Parse(header)
	if err != nil {
		log.Println("Error Parsing HX-Current-URL for Graph Table")
	}

	params, err := url.ParseQuery(currentURL.RawQuery)
	paramFilter := params.Get("filter")
	if err == nil && paramFilter != "" {
		selectedfilter = paramFilter
	}

	// Use Switch Case for Sanitization of upcoming SQL Statement and simpler querys in Web UI
	filter := "24 Hours"
	switch selectedfilter {
	case "24h":
		filter = "24 Hours"
	case "7d":
		filter = "7 days"
	case "30d":
		filter = "30 days"
	}

	data, err := a.db.LookupApiKeyUserStats(g.key, g.kind, filter)
	if err != nil {
		log.Println(err)
		http.Error(g.w, "Could not get Data from DB for User "+string(g.key), 500)
		return
	}

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

	// Put data into instance
	td, err := a.GetAdminTableGraphData(g.w, data, filter)
	if err != nil {
		return
	}

	line.SetXAxis(td.timeAxis).
		AddSeries(fmt.Sprintf("last %s", filter), td.data)
	// Where the magic happens
	chartSnippet := line.RenderSnippet()

	tmpl := "{{.Element}} {{.Script}}"
	t := template.New("snippet")
	t, err = t.Parse(tmpl)
	if err != nil {
		log.Println("error templating", err)

	}
	snippetData := struct {
		Element template.HTML
		Script  template.HTML
		Option  template.HTML
	}{
		Element: template.HTML(chartSnippet.Element),
		Script:  template.HTML(chartSnippet.Script),
		Option:  template.HTML(chartSnippet.Option),
	}
	// var buf bytes.Buffer
	if err := t.Execute(g.w, snippetData); err != nil {
		log.Println("Error Templating Chart", err)
		return
	}

	// line.RenderSnippet()
	// log.Println(buf.String())

}

type TableData struct {
	data     []opts.LineData
	timeAxis []string
}

func (a *ApiHandler) GetAdminTableGraphData(w http.ResponseWriter, d []db.RequestSummary, filter string) (*TableData, error) {

	td := &TableData{
		data:     make([]opts.LineData, 0),
		timeAxis: make([]string, 0),
	}
	var totalTokens int
	format := "15:04"
	switch filter {
	case "24 Hours":
		format = "15:04"
	case "7 days":
		format = "Mon"
	case "30 days":
		format = "02"
	}
	if len(d) < 1 {
		http.Error(w, "&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;No Data", 200)
		err := errors.New("data for Key is Empty")
		return nil, err
	}
	for _, item := range d {
		totalTokens = item.TokenCountComplete + item.TokenCountPrompt
		td.data = append(td.data, opts.LineData{Value: totalTokens})
		loc, err := time.LoadLocation(a.timeZone)
		if err != nil {
			log.Println("Error Displaying Timezone, maybe the TIMEZONE env is wrongly set")
			td.timeAxis = append(td.timeAxis, item.RequestTime.Format(format))
			continue
		}
		localTime := item.RequestTime.In(loc)
		td.timeAxis = append(td.timeAxis, localTime.Format(format))

	}
	return td, nil
}
