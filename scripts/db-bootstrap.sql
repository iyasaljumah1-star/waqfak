-- Run ONCE as a PostgreSQL superuser/DBA when provisioning a new environment.
-- Replace passwords with strong secrets from your secrets manager.
CREATE ROLE waqfak_owner LOGIN PASSWORD 'CHANGE_ME_OWNER' CREATEDB;
CREATE ROLE waqfak_app   LOGIN PASSWORD 'CHANGE_ME_APP';
CREATE ROLE waqfak_mlro  NOLOGIN;
GRANT waqfak_mlro TO waqfak_app;           -- app may SET LOCAL ROLE waqfak_mlro; the restricted rows still need a bound MLRO
-- Stage 11: the sign-in (sessions, codes, second factor, accounts) and the system context (jobs, public reads, link
-- pages) are separate logins. The application role is a member of NEITHER; the system role uses the application's
-- policies as the system, so it is a member of waqfak_app (never the reverse). security.sql refuses to run otherwise.
CREATE ROLE waqfak_auth   LOGIN PASSWORD 'CHANGE_ME_AUTH';
CREATE ROLE waqfak_system LOGIN PASSWORD 'CHANGE_ME_SYSTEM';
GRANT waqfak_app TO waqfak_system;
CREATE DATABASE waqfak OWNER waqfak_owner;
