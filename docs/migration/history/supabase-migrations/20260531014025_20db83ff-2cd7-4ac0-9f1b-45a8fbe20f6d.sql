-- Replace backfilled single-stage rows with a full mock progression for ION-1 and ION-3.
DELETE FROM public.ticket_stage_history
WHERE ticket_id IN (
  'a7217c9b-7ce4-4949-9dbc-97f22f0d20ef', -- ION-1
  'a2cfa021-db9c-4e9f-8d04-d1e862c856b1'  -- ION-3
);

-- ION-1 (Sprint 1: May 1 -> May 15) progressing through every stage
INSERT INTO public.ticket_stage_history (ticket_id, project_id, column_id, column_name, entered_at) VALUES
('a7217c9b-7ce4-4949-9dbc-97f22f0d20ef','71d128b0-1dde-41a6-8bcf-373d88474155','c178bb7c-7e2d-4b59-8e23-c83050c5a2cb','Backlog','2026-05-02 09:00:00+00'),
('a7217c9b-7ce4-4949-9dbc-97f22f0d20ef','71d128b0-1dde-41a6-8bcf-373d88474155','834c5404-a36f-45b9-9a9d-9e1f00767725','In Progress','2026-05-04 10:30:00+00'),
('a7217c9b-7ce4-4949-9dbc-97f22f0d20ef','71d128b0-1dde-41a6-8bcf-373d88474155','79378ee7-f4f7-430c-9735-f149f2ae4240','Ready to Test','2026-05-08 14:00:00+00'),
('a7217c9b-7ce4-4949-9dbc-97f22f0d20ef','71d128b0-1dde-41a6-8bcf-373d88474155','c2ed0392-2c7f-4bb0-a12b-280cf4d0e0f0','Ready to Deploy','2026-05-11 11:15:00+00'),
('a7217c9b-7ce4-4949-9dbc-97f22f0d20ef','71d128b0-1dde-41a6-8bcf-373d88474155','d6807749-f49c-473c-b6e3-f5b143f89bac','Deployed','2026-05-13 16:45:00+00'),
('a7217c9b-7ce4-4949-9dbc-97f22f0d20ef','71d128b0-1dde-41a6-8bcf-373d88474155','2d26b8e6-4a43-44b8-b7e0-78cf34fb6622','Complete','2026-05-15 09:30:00+00');

-- ION-3 (Sprint 2: May 16 -> May 30) progressing through most stages
INSERT INTO public.ticket_stage_history (ticket_id, project_id, column_id, column_name, entered_at) VALUES
('a2cfa021-db9c-4e9f-8d04-d1e862c856b1','71d128b0-1dde-41a6-8bcf-373d88474155','c178bb7c-7e2d-4b59-8e23-c83050c5a2cb','Backlog','2026-05-17 08:30:00+00'),
('a2cfa021-db9c-4e9f-8d04-d1e862c856b1','71d128b0-1dde-41a6-8bcf-373d88474155','834c5404-a36f-45b9-9a9d-9e1f00767725','In Progress','2026-05-20 13:00:00+00'),
('a2cfa021-db9c-4e9f-8d04-d1e862c856b1','71d128b0-1dde-41a6-8bcf-373d88474155','79378ee7-f4f7-430c-9735-f149f2ae4240','Ready to Test','2026-05-23 10:00:00+00'),
('a2cfa021-db9c-4e9f-8d04-d1e862c856b1','71d128b0-1dde-41a6-8bcf-373d88474155','c2ed0392-2c7f-4bb0-a12b-280cf4d0e0f0','Ready to Deploy','2026-05-26 15:30:00+00'),
('a2cfa021-db9c-4e9f-8d04-d1e862c856b1','71d128b0-1dde-41a6-8bcf-373d88474155','d6807749-f49c-473c-b6e3-f5b143f89bac','Deployed','2026-05-28 12:00:00+00');