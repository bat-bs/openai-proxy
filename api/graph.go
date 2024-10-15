package api

import (
	"fmt"
	"html/template"
	"log"
	"net/http"
	db "openai-api-proxy/db"
	"strings"

	"github.com/go-echarts/go-echarts/v2/charts"
	"github.com/go-echarts/go-echarts/v2/opts"
)

func (a *ApiHandler) GetAdminTableGraph(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.URL.Path, "/api2/admin/table/graph/get/")
	log.Println(key)
	data, err := a.db.LookupApiKeyUserStats(key)
	if err != nil {
		log.Println(err)
		http.Error(w, "Could not get Data from DB for User "+string(key), 500)
		return
	}
	log.Println(data)
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

	selectedfilter := "24h"
	// Put data into instance
	td := a.GetAdminTableGraphData(data)

	line.SetXAxis(td.timeAxis).
		AddSeries(fmt.Sprintf("last %s", selectedfilter), td.data)
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
	if err := t.Execute(w, snippetData); err != nil {
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

func (a *ApiHandler) GetAdminTableGraphData(d []db.RequestSummary) TableData {

	td := TableData{
		data:     make([]opts.LineData, 0),
		timeAxis: make([]string, 0),
	}
	var totalTokens int

	for _, item := range d {
		totalTokens = item.TokenCountComplete + item.TokenCountPrompt
		td.data = append(td.data, opts.LineData{Value: totalTokens})
		td.timeAxis = append(td.timeAxis, item.RequestTime.Format("15:04"))
	}
	return td
}
