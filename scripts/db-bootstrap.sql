-- Run ONCE as a PostgreSQL superuser/DBA when provisioning a new environment.
-- Replace passwords with strong secrets from your secrets manager.
CREATE ROLE waqfak_owner LOGIN PASSWORD 'CHANGE_ME_OWNER' CREATEDB;
CREATE ROLE waqfak_app   LOGIN PASSWORD 'CHANGE_ME_APP';
CREATE ROLE waqfak_mlro  NOLOGIN;
GRANT waqfak_mlro TO waqfak_app;           -- app may SET LOCAL ROLE waqfak_mlro for the MLRO user only
CREATE DATABASE waqfak OWNER waqfak_owner;
