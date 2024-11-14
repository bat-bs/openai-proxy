package costs

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	db "openai-api-proxy/db"
	"regexp"
	"time"
)

// Collect Cost of Azure DB and Write them to DB

type BaseJson struct {
	Costs []Costs `json:"Items"`
}
type Costs struct {
	ModelName     string
	RetailPrice   float32 `json:"retailPrice"`
	SKUName       string  `json:"skuName"`
	UnitOfMeasure string  `json:"unitOfMeasure"`
	TokenType     string
	Currency      string
	IsRegional    bool
}

const MoneyUnit = 10000000

func GetAllCosts(d *db.Database, g <-chan time.Time) {
	for ; true; <-g {
		log.Println("Azure: Collecting Prices")
		totalCosts := []*Costs{}
		tokenTypes := []string{"Input", "Output"}
		models := d.LookupModels()
		cleanModel := regexp.MustCompile(`-[0-9]{4}-[0-9]{2}-[0-9]{2}`)
		if len(models) == 0 {
			log.Println("No Models in DB yet, no costs can be calculated")
			return
		}

		for _, model := range models {
			modelName := cleanModel.ReplaceAllString(model, "")
			for _, tokenType := range tokenTypes {
				c := GetCosts(modelName, tokenType)
				c.TokenType = tokenType
				c.ModelName = modelName
				totalCosts = append(totalCosts, c)
			}
		}
		dbcosts := []*db.Costs{}
		for _, costs := range totalCosts {
			dbc := &db.Costs{
				ModelName:     costs.ModelName,
				RetailPrice:   int64(costs.RetailPrice * float32(MoneyUnit)),
				TokenType:     costs.TokenType,
				UnitOfMeasure: costs.UnitOfMeasure,
				IsRegional:    costs.IsRegional,
				BackendName:   "azure",
			}
			dbcosts = append(dbcosts, dbc)
		}
		err := d.WriteCosts(dbcosts)
		if err != nil {
			log.Println(err)
		}
	}
}

func GetCosts(modelName string, tokenType string) *Costs {
	currency := "EUR"
	regionName := "swedencentral"
	productName := "Azure OpenAI"
	regional := true
	errorContext := fmt.Sprintf("Check ENV - regional: %s, regionName: %s, currency: %s", regional, regionName, currency)

	var region string

	if regional {
		region = "regional"
	} else {
		region = "global"
	}

	rq, err := http.NewRequest("GET", "https://prices.azure.com/api/retail/prices", nil)
	if err != nil {
		log.Println("Could not get latest Prices from API", errorContext)
	}

	filter := fmt.Sprintf("productName eq '%s' and armRegionName eq '%s' and skuName eq '%s-%s-%s'", productName, regionName, modelName, tokenType, region)
	q := rq.URL.Query()
	q.Add("currencyCode", currency)
	q.Add("$filter", filter)
	rq.URL.RawQuery = q.Encode()

	client := &http.Client{}
	resp, err := client.Do(rq)
	if err != nil {
		log.Println("Error Requesting Data from Azure API.", errorContext)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Println("Error Parsing Body")
		log.Println(err)
	}
	var base *BaseJson

	resp.Body = io.NopCloser(bytes.NewReader(body))
	json.Unmarshal(body, &base)
	c := &base.Costs[0]
	c.IsRegional = regional
	c.Currency = currency
	return c
}
