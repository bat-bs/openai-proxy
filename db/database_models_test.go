package database

import (
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestWriteRerankRequestIsIdempotentForIdenticalRows(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer sqlDB.Close()

	d := &Database{db: sqlDB}
	request := &Request{
		ID:             "rerank-id",
		ApiKeyID:       "key-id",
		RequestType:    RequestTypeRerank,
		SearchUnits:    ptrInt(7),
		Model:          "Cohere-rerank-v4.0-fast",
		IsApproximated: false,
	}
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO requests (
			id, api_key_id, request_type, search_units, model, snapshot_version, is_approximated
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (id) DO NOTHING`)).
		WithArgs(request.ID, request.ApiKeyID, RequestTypeRerank, request.SearchUnits, request.Model, nil, false).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT api_key_id, request_type, search_units, model, is_approximated
		FROM requests WHERE id = $1`)).
		WithArgs(request.ID).
		WillReturnRows(sqlmock.NewRows([]string{"api_key_id", "request_type", "search_units", "model", "is_approximated"}).
			AddRow(request.ApiKeyID, RequestTypeRerank, 7, request.Model, false))

	if err := d.WriteRerankRequest(request); err != nil {
		t.Fatalf("WriteRerankRequest: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("mock expectations: %v", err)
	}
}

func TestLookupConfiguredModelType(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer sqlDB.Close()

	d := &Database{db: sqlDB}
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT model_type FROM models WHERE lower(id) = lower($1)`)).
		WithArgs("Cohere-rerank-v4.0-fast").
		WillReturnRows(sqlmock.NewRows([]string{"model_type"}).AddRow(ModelTypeRerank))

	modelType, found, err := d.LookupConfiguredModelType("Cohere-rerank-v4.0-fast")
	if err != nil || !found || modelType != ModelTypeRerank {
		t.Fatalf("unexpected lookup result: type=%q found=%t err=%v", modelType, found, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("mock expectations: %v", err)
	}
}

func TestAddConfiguredModelWithType(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer sqlDB.Close()

	d := &Database{db: sqlDB}
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO models (id, model_type) VALUES ($1, $2) ON CONFLICT DO NOTHING`)).
		WithArgs("Cohere-rerank-v4.0-fast", ModelTypeRerank).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := d.AddConfiguredModelWithType("Cohere-rerank-v4.0-fast", ModelTypeRerank); err != nil {
		t.Fatalf("AddConfiguredModelWithType: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("mock expectations: %v", err)
	}
}
