import { createClient } from '@supabase/supabase-js'

// URL y llave publicable son públicas por diseño: la base solo deja a cada persona ver lo suyo (RLS).
export const supabase = createClient(
  'https://soanuxwzrixrtslsqpyf.supabase.co',
  'sb_publishable_irghiEwZOPnUIof8HXIoPw_1DX0G218',
  { auth: { flowType: 'pkce' } },
)
