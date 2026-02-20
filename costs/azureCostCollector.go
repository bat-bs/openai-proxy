package costs

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	db "openai-api-proxy/db"
	"strings"
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
	regional := true
	var region string
	if regional {
		region = "regnl"
	} else {
		region = "glbl"
	}

	for ; true; <-g {
		log.Println("Azure: Collecting Prices")
		totalCosts := []*Costs{}
		tokenTypes := []string{"Inp", "Outp"}
		models := d.LookupModels()
		if len(models) == 0 {
			log.Println("No Models in DB yet, no costs can be calculated")
			continue
		}
		// Because Microsoft cannot decide to either use a space or a dash we have to handle both :)
		microsoftSpecialSeperator := []string{"-", " "}

		for _, model := range models {
			modelSplit := strings.Split(model, "-")
			if len(modelSplit) < 5 {
				log.Printf("skipping model %s (unexpected format)", model)
				continue
			}
			for _, sep := range microsoftSpecialSeperator {
				for _, tokenType := range tokenTypes {
					skuName := fmt.Sprintf("%s-%s-%s%s-%s-%s", modelSplit[0], modelSplit[1], modelSplit[3], modelSplit[4], tokenType, region)
					if sep != "-" {
						skuName = strings.ReplaceAll(skuName, "-", sep)
					}
					c := GetCosts(skuName, tokenType)
					if c.SKUName != "" {
						c.TokenType = tokenType
						c.IsRegional = regional
						c.ModelName = model
						totalCosts = append(totalCosts, c)
					}
				}
			}
		}
		dbcosts := []*db.Costs{}
		for _, costs := range totalCosts {
			dbc := &db.Costs{
				ModelName:     costs.ModelName,
				RetailPrice:   int(costs.RetailPrice * float32(MoneyUnit)),
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

func GetCosts(skuName string, tokenType string) *Costs {
	currency := "EUR"
	regionName := "swedencentral"
	productName := "Azure OpenAI"

	errorContext := fmt.Sprintf("Check ENV - regionName: %s, currency: %s", regionName, currency)

	rq, err := http.NewRequest("GET", "https://prices.azure.com/api/retail/prices", nil)
	if err != nil {
		log.Println("Could not get latest Prices from API", errorContext)
	}

	filter := fmt.Sprintf("productName eq '%s' and armRegionName eq '%s' and skuName eq '%s' ", productName, regionName, skuName)
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
	if len(base.Costs) == 0 {
		return &Costs{}
	}
	c := &base.Costs[0]
	c.Currency = currency
	return c
}
