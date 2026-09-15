CREATE TABLE activities (id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES runs, kind text NOT NULL CHECK(kind IN ('command','fileChange','tool','compacting')), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX activities_run ON activities(run_id,created_at);
