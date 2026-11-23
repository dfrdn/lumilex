-- Tables in the supabase_realtime publication (9 in live DB).

alter publication supabase_realtime add table public.chat_channels;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.chat_reactions;
alter publication supabase_realtime add table public.chat_read_receipts;
alter publication supabase_realtime add table public.client_intakes;
alter publication supabase_realtime add table public.file_analyses;
alter publication supabase_realtime add table public.files;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.parties;
