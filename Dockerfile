# Copyright 2020 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# [START cloudrun_helloworld_dockerfile]
# [START run_helloworld_dockerfile]

# Use the offical golang image to create a binary.
# This is based on Debian and sets the GOPATH to /go.
# https://hub.docker.com/_/golang
FROM golang:1.23-alpine as builder
RUN apk add --no-cache gcc g++
# Create and change to the app directory.
WORKDIR /app
ARG CGO_ENABLED=1
# Retrieve application dependencies.
# This allows the container build to reuse cached dependencies.
# Expecting to copy go.mod and if present go.sum.
COPY go.* ./
RUN go mod download

COPY . ./
RUN go build -o server -v  cmd/main.go 


## Runtime Stage
FROM alpine:latest

RUN mkdir -p /app/db/migrations
COPY --from=builder /app/server /app/server
COPY db/schema.sql /app/db/schema.sql
COPY db/migrations/* /app/db/migrations
RUN chmod +x /app/server
WORKDIR /app
CMD ["/app/server"]