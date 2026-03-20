export const USER_COLORS = [
  { bg: 'rgba(200,240,0,0.15)', border: 'rgba(200,240,0,0.5)', text: '#C8F000' },
  { bg: 'rgba(255,107,43,0.15)', border: 'rgba(255,107,43,0.5)', text: '#FF6B2B' },
  { bg: 'rgba(100,180,255,0.15)', border: 'rgba(100,180,255,0.5)', text: '#64B4FF' },
  { bg: 'rgba(200,120,255,0.15)', border: 'rgba(200,120,255,0.5)', text: '#C878FF' },
]

// Assigns colors based on leaderboard rank order — fetched once and reused
export async function getUserColorMap(supabase) {
  const { data: lb } = await supabase
    .from('leaderboard')
    .select('user_id')

  const map = {}
  ;(lb ?? []).forEach((u, i) => {
    map[u.user_id] = USER_COLORS[i % USER_COLORS.length]
  })
  return map
}
