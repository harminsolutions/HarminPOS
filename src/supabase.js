import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ldfsyzcyyhfghziunzua.supabase.co'
const supabaseKey = 'sb_publishable_2BOf-U6TkPSgDTh7uFMOUQ_WmqWPCCf'

export const supabase = createClient(supabaseUrl, supabaseKey)