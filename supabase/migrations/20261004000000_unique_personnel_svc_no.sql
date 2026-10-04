BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.personnel
    WHERE svc_no IS NOT NULL
    GROUP BY svc_no
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce unique personnel service numbers: duplicate svc_no values exist. Resolve duplicates, then rerun this migration.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS personnel_svc_no_unique_idx
  ON public.personnel (svc_no);

COMMIT;
