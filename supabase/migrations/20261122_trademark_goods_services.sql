-- The goods or services a mark is filed for, by Nice class: {"9": "…", "35": "…"}.
-- Client reports print it per class; the class numbers stay in `classes`.
ALTER TABLE public.trademarks
  ADD COLUMN IF NOT EXISTS goods_services jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trademarks_goods_services_object') THEN
    ALTER TABLE public.trademarks
      ADD CONSTRAINT trademarks_goods_services_object CHECK (jsonb_typeof(goods_services) = 'object');
  END IF;
END $$;
