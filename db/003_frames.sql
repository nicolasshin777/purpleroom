-- СпектрОптик: кадры правок в файловом хранилище (запускать в SQL-редакторе базы spectroptik
-- после включения «Файлов»). Можно запускать повторно. Ничего не удаляет.

-- Закрытая папка для кадров: только изображения, до 2 МБ
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('spo-frames', 'spo-frames', false, 2097152, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

-- Права на файлы: таблица storage.objects одна на все папки, поэтому каждое правило — только для spo-frames
grant select, insert, update, delete on storage.objects to authenticated;

drop policy if exists spo_frames_read   on storage.objects;
drop policy if exists spo_frames_insert on storage.objects;
drop policy if exists spo_frames_update on storage.objects;
drop policy if exists spo_frames_delete on storage.objects;

-- смотреть и загружать кадры — команда с ролью; удалять — продюсер
create policy spo_frames_read on storage.objects for select to authenticated
  using (bucket_id = 'spo-frames' and public.spo_role() in ('producer', 'editor', 'client'));
create policy spo_frames_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'spo-frames' and public.spo_role() in ('producer', 'editor', 'client'));
create policy spo_frames_update on storage.objects for update to authenticated
  using (bucket_id = 'spo-frames' and public.spo_role() in ('producer', 'editor', 'client'))
  with check (bucket_id = 'spo-frames' and public.spo_role() in ('producer', 'editor', 'client'));
create policy spo_frames_delete on storage.objects for delete to authenticated
  using (bucket_id = 'spo-frames' and public.spo_role() = 'producer');
