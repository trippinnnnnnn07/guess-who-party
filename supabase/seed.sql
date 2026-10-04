-- Optional original fictional sample bank. Safe to run again; no real-person facts.
-- The bundled SVG artwork is served by the app, never uploaded by players.
begin;
insert into public.quiz_categories(name) values ('ตัวอย่าง · ตัวละครสมมติ') on conflict(name) do nothing;
with samples(title,hint,explanation,options) as (values
  ('โจทย์ตัวอย่าง 1 · ใครต่างจากเพื่อน?', 'พลังไฟ', 'เหมันต์ใช้พลังน้ำแข็ง ส่วนอัคคี ประกาย และคบเพลิงใช้พลังไฟ (เรื่องสมมติ)',
   '[{"name":"อัคคี","source":"ผู้พิทักษ์ธาตุ · เรื่องสมมติ","imagePath":"builtin/fire.svg"},{"name":"ประกาย","source":"ผู้พิทักษ์ธาตุ · เรื่องสมมติ","imagePath":"builtin/fire.svg"},{"name":"คบเพลิง","source":"ผู้พิทักษ์ธาตุ · เรื่องสมมติ","imagePath":"builtin/fire.svg"},{"name":"เหมันต์","source":"ผู้พิทักษ์ธาตุ · เรื่องสมมติ","imagePath":"builtin/ice.svg"}]'::jsonb),
  ('โจทย์ตัวอย่าง 2 · ใครต่างจากเพื่อน?', 'พลังน้ำแข็ง', 'ภูผาใช้พลังดิน ส่วนเกล็ดหิมะ เหมันต์ และธารเย็นใช้พลังน้ำแข็ง (เรื่องสมมติ)',
   '[{"name":"เกล็ดหิมะ","source":"ผู้พิทักษ์ธาตุ · เรื่องสมมติ","imagePath":"builtin/ice.svg"},{"name":"เหมันต์","source":"ผู้พิทักษ์ธาตุ · เรื่องสมมติ","imagePath":"builtin/ice.svg"},{"name":"ธารเย็น","source":"ผู้พิทักษ์ธาตุ · เรื่องสมมติ","imagePath":"builtin/ice.svg"},{"name":"ภูผา","source":"ผู้พิทักษ์ธาตุ · เรื่องสมมติ","imagePath":"builtin/earth.svg"}]'::jsonb),
  ('โจทย์ตัวอย่าง 3 · ใครต่างจากเพื่อน?', 'พลังดิน', 'อัคคีใช้พลังไฟ ส่วนภูผา ศิลา และปฐพีใช้พลังดิน (เรื่องสมมติ)',
   '[{"name":"ภูผา","source":"ผู้พิทักษ์ธาตุ · เรื่องสมมติ","imagePath":"builtin/earth.svg"},{"name":"ศิลา","source":"ผู้พิทักษ์ธาตุ · เรื่องสมมติ","imagePath":"builtin/earth.svg"},{"name":"ปฐพี","source":"ผู้พิทักษ์ธาตุ · เรื่องสมมติ","imagePath":"builtin/earth.svg"},{"name":"อัคคี","source":"ผู้พิทักษ์ธาตุ · เรื่องสมมติ","imagePath":"builtin/fire.svg"}]'::jsonb)
)
insert into public.quiz_questions(category_id,title,options,correct_index,hint,explanation,status)
select c.id,s.title,s.options,3,s.hint,s.explanation,'approved' from samples s cross join public.quiz_categories c
where c.name='ตัวอย่าง · ตัวละครสมมติ' and not exists(select 1 from public.quiz_questions q where q.title=s.title and q.author_id is null);
commit;
