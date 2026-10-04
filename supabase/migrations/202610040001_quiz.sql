-- Run once in a NEW Supabase project's SQL editor. No existing tables are deleted.
begin;

create table public.quiz_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.quiz_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 60),
  active boolean not null default true
);
create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users(id) on delete set null,
  category_id uuid not null references public.quiz_categories(id),
  title text not null check (length(title) between 1 and 160),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_index integer not null check (correct_index between 0 and 3),
  hint text not null check (length(hint) between 1 and 100),
  explanation text not null check (length(explanation) between 1 and 1000),
  status text not null default 'draft' check (status in ('draft','pending','approved','changes_requested','hidden','deleted')),
  review_note text not null default '',
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quiz_questions_pick_idx on public.quiz_questions(status, category_id);
create index quiz_questions_author_idx on public.quiz_questions(author_id, updated_at desc);
create index quiz_questions_category_idx on public.quiz_questions(category_id);
create table public.quiz_reviews (
  id bigint generated always as identity primary key,
  question_id uuid not null references public.quiz_questions(id),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  note text not null default '',
  revision integer not null,
  created_at timestamptz not null default now()
);

-- The browser must NEVER read the bank/answers, roles, or storage directly.
create index quiz_reviews_question_idx on public.quiz_reviews(question_id, created_at desc);
create index quiz_reviews_actor_idx on public.quiz_reviews(actor_id);
-- All operations go through Express, which verifies Google identity and permissions.
alter table public.quiz_admins enable row level security;
alter table public.quiz_categories enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_reviews enable row level security;
revoke all on public.quiz_admins, public.quiz_categories, public.quiz_questions, public.quiz_reviews from anon, authenticated;
grant all on public.quiz_admins, public.quiz_categories, public.quiz_questions, public.quiz_reviews to service_role;
grant usage, select on sequence public.quiz_reviews_id_seq to service_role;

insert into public.quiz_categories(name) values ('อนิเมะ'), ('หนัง'), ('กีฬา');
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('quiz-images', 'quiz-images', false, 3145728, array['image/png','image/jpeg','image/webp']);

-- Atomic save + audit + revision check prevents approving an unseen concurrent edit.
create function public.quiz_save_question(p_actor uuid, p_id uuid, p_revision integer, p_data jsonb)
returns public.quiz_questions language plpgsql security invoker set search_path = '' as $$
declare old_row public.quiz_questions; saved public.quiz_questions; is_admin boolean;
begin
  select exists(select 1 from public.quiz_admins where user_id = p_actor) into is_admin;
  if p_id is not null then
    select * into old_row from public.quiz_questions where id = p_id for update;
    if not found or old_row.status = 'deleted' then raise exception 'NOT_FOUND'; end if;
    if old_row.author_id is distinct from p_actor and not is_admin then raise exception 'FORBIDDEN'; end if;
    if old_row.revision <> p_revision then raise exception 'CONFLICT'; end if;
  end if;
  if p_data->>'status' not in ('draft','pending') then raise exception 'INVALID_STATUS'; end if;
  if p_id is null then
    insert into public.quiz_questions(author_id, category_id, title, options, correct_index, hint, explanation, status)
    values(p_actor, (p_data->>'category_id')::uuid, p_data->>'title', p_data->'options', (p_data->>'correct_index')::integer, p_data->>'hint', p_data->>'explanation', p_data->>'status') returning * into saved;
  else
    update public.quiz_questions set category_id=(p_data->>'category_id')::uuid, title=p_data->>'title', options=p_data->'options', correct_index=(p_data->>'correct_index')::integer, hint=p_data->>'hint', explanation=p_data->>'explanation', status=p_data->>'status', review_note='', revision=revision+1, updated_at=now()
    where id=p_id returning * into saved;
  end if;
  insert into public.quiz_reviews(question_id, actor_id, action, revision) values(saved.id, p_actor, 'save:' || saved.status, saved.revision);
  return saved;
end $$;

create function public.quiz_review_question(p_actor uuid, p_id uuid, p_revision integer, p_status text, p_note text)
returns public.quiz_questions language plpgsql security invoker set search_path = '' as $$
declare old_row public.quiz_questions; saved public.quiz_questions;
begin
  if not exists(select 1 from public.quiz_admins where user_id=p_actor) then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('approved','changes_requested','hidden','deleted') then raise exception 'INVALID_STATUS'; end if;
  if length(p_note) > 1000 or (p_status='changes_requested' and length(trim(p_note))=0) then raise exception 'INVALID_NOTE'; end if;
  select * into old_row from public.quiz_questions where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if old_row.revision <> p_revision then raise exception 'CONFLICT'; end if;
  if p_status='approved' and old_row.status <> 'pending' then raise exception 'NOT_PENDING'; end if;
  if old_row.status='deleted' then raise exception 'NOT_FOUND'; end if;
  update public.quiz_questions set status=p_status, review_note=p_note, revision=revision+1, updated_at=now() where id=p_id returning * into saved;
  insert into public.quiz_reviews(question_id, actor_id, action, note, revision) values(p_id, p_actor, p_status, p_note, saved.revision);
  return saved;
end $$;

create function public.quiz_pick_questions(p_categories uuid[], p_excluded_authors uuid[], p_count integer)
returns setof public.quiz_questions language sql security invoker set search_path = '' as $$
  select * from public.quiz_questions
  where status='approved'
    and (coalesce(cardinality(p_categories),0)=0 or category_id=any(p_categories))
    and (author_id is null or not(author_id=any(coalesce(p_excluded_authors,'{}'::uuid[]))))
    and category_id in (select id from public.quiz_categories where active)
  order by random() limit greatest(0, least(p_count,20));
$$;

revoke all on function public.quiz_save_question(uuid,uuid,integer,jsonb) from public, anon, authenticated;
revoke all on function public.quiz_review_question(uuid,uuid,integer,text,text) from public, anon, authenticated;
revoke all on function public.quiz_pick_questions(uuid[],uuid[],integer) from public, anon, authenticated;
grant execute on function public.quiz_save_question(uuid,uuid,integer,jsonb) to service_role;
grant execute on function public.quiz_review_question(uuid,uuid,integer,text,text) to service_role;
grant execute on function public.quiz_pick_questions(uuid[],uuid[],integer) to service_role;
commit;
