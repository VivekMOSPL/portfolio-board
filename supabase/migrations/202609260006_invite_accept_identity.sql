begin;
-- An invitation is bound to the invited email. The single generic error made a signed-in email
-- mismatch look like an expired token. Keep the generic message for a token that is genuinely
-- unknown, expired or already used, and name the required account when the token is valid but
-- the caller is signed in as somebody else.
alter function cb_command(uuid,text,jsonb) rename to cb_command_prev;
create function cb_command(p_tenant uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare invited_email text;
begin
 if not cb_access_valid() then raise exception 'Authentication required' using errcode='28000';end if;
 if p_action='invite.accept' then
  select email into invited_email from cb_invitations
  where token_hash=encode(sha256(convert_to(p_data->>'token','UTF8')),'hex')
  and used_at is null and revoked_at is null and expires_at>now();
  if invited_email is not null and lower(invited_email)<>lower(coalesce(auth.jwt()->>'email','')) then
   raise exception 'Sign in as % to accept this invitation', invited_email using errcode='42501';
  end if;
 end if;
 return cb_command_prev(p_tenant,p_action,p_data);
end$$;
-- The previous definition must not stay directly callable.
revoke execute on function cb_command_prev(uuid,text,jsonb) from authenticated,anon,public;
revoke all on function cb_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function cb_command(uuid,text,jsonb) to authenticated;
commit;
