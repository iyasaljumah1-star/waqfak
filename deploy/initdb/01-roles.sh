#!/bin/sh
# Runs once on the first start of an empty PostgreSQL volume. Creates the least-privilege roles.
set -e
psql -v ON_ERROR_STOP=1 --username postgres <<SQL
CREATE ROLE waqfak_owner LOGIN PASSWORD '${OWNER_DB_PASSWORD}' CREATEDB;
CREATE ROLE waqfak_app   LOGIN PASSWORD '${APP_DB_PASSWORD}';
CREATE ROLE waqfak_mlro  NOLOGIN;
GRANT waqfak_mlro TO waqfak_app;
CREATE DATABASE waqfak OWNER waqfak_owner;
SQL
