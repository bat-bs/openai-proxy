package api

import (
	"html/template"
	"log"
	"net/http"
	"strings"
)

func (a *ApiHandler) GetModelsTable(w http.ResponseWriter, r *http.Request) {
	ok, err := a.auth.ValidateAdminSession(w, r)
	if err == nil && ok {
		models, err := a.db.ListConfiguredModels()
		if err != nil {
			log.Printf("Error fetching models: %v", err)
			http.Error(w, "Error fetching models", http.StatusInternalServerError)
			return
		}

		templContent := `
<div class="mt-8">
    <h2 class="text-2xl font-bold mb-4">Model Management</h2>
    <div class="mb-4">
        <form hx-post="/api2/admin/models/add" hx-target="#models-table-container" hx-swap="innerHTML">
            <input type="text" name="model_id" placeholder="Model ID (e.g. gpt-4)" class="p-2 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500" required>
            <button type="submit" class="ml-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                Add Model
            </button>
        </form>
    </div>
    <div class="flex flex-wrap gap-2 p-4 bg-white dark:bg-slate-900 rounded-lg shadow">
        {{if .}}
            {{range .}}
            <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                {{.}}
                <button hx-delete="/api2/admin/models/delete/{{.}}" hx-target="#models-table-container" hx-swap="innerHTML" class="ml-2 inline-flex items-center p-0.5 rounded-full text-blue-400 hover:bg-blue-200 hover:text-blue-500 focus:outline-none">
                    <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </button>
            </span>
            {{end}}
        {{else}}
            <p class="text-gray-500">No models configured.</p>
        {{end}}
    </div>
</div>
`
		templ, err := template.New("modelsTable").Parse(templContent)
		if err != nil {
			log.Printf("Error parsing template: %v", err)
			http.Error(w, "Error parsing template", http.StatusInternalServerError)
			return
		}

		err = templ.Execute(w, models)
		if err != nil {
			log.Printf("Error executing template: %v", err)
		}
	} else {
		http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
	}
}

func (a *ApiHandler) AddModel(w http.ResponseWriter, r *http.Request) {
	ok, err := a.auth.ValidateAdminSession(w, r)
	if err == nil && ok {
		r.ParseForm()
		modelID := strings.TrimSpace(r.Form.Get("model_id"))
		if modelID != "" {
			err := a.db.AddConfiguredModel(modelID)
			if err != nil {
				log.Printf("Error adding model: %v", err)
			}
		}
		a.GetModelsTable(w, r)
	} else {
		http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
	}
}

func (a *ApiHandler) DeleteModel(w http.ResponseWriter, r *http.Request) {
	ok, err := a.auth.ValidateAdminSession(w, r)
	if err == nil && ok {
		modelID := strings.TrimPrefix(r.URL.Path, "/api2/admin/models/delete/")
		if modelID != "" {
			err := a.db.DeleteConfiguredModel(modelID)
			if err != nil {
				log.Printf("Error deleting model: %v", err)
			}
		}
		a.GetModelsTable(w, r)
	} else {
		http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
	}
}
