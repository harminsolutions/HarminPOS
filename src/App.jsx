import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export default function App() {
  // Global & Routing State
  const [session, setSession] = useState(null)
  const [tenant, setTenant] = useState(null)
  const [activeStaff, setActiveStaff] = useState(null)
  const [loading, setLoading] = useState(true)
  
  // Gateways: 'management', 'terminal'
  const [loginGateway, setLoginGateway] = useState('management')
  
  // Auth Form State
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [storeCode, setStoreCode] = useState('')
  const [staffPin, setStaffPin] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)

  // System Admin (Tier 1) State
  const [allTenants, setAllTenants] = useState([])
  const [platformSales, setPlatformSales] = useState([])
  
  const SYSTEM_ADMIN_EMAIL = 'harminsolutions96@gmail.com'

  // --- 1. INITIALIZATION & SESSION MANAGEMENT ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) handleTier1And2Auth(session.user)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        handleTier1And2Auth(session.user)
      } else if (!activeStaff) { 
        setTenant(null)
        setActiveStaff(null)
        setLoading(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [activeStaff])

  // --- 2. DATA FETCHING (TIER 1) ---
  const fetchPlatformOverview = async () => {
    const { data: tenantsData } = await supabase.from('tenants').select('*').order('created_at', { ascending: false })
    const { data: salesData } = await supabase.from('sales').select('*').order('created_at', { ascending: false })
    setAllTenants(tenantsData || [])
    setPlatformSales(salesData || [])
  }

  const approveTenant = async (tenantId) => {
    const { error } = await supabase.from('tenants').update({ is_approved: true }).eq('id', tenantId)
    if (!error) fetchPlatformOverview()
    else alert("Error approving tenant: " + error.message)
  }

  // --- 3. TIER 1 & 2 ROUTING (MANAGEMENT GATEWAY) ---
  const handleTier1And2Auth = async (user) => {
    setLoading(true)
    
    // TIER 1: System Admin (IT)
    if (user.email === SYSTEM_ADMIN_EMAIL) {
      await fetchPlatformOverview()
      setActiveStaff({ 
        role: { name: 'System Admin', tier_level: 1 }, 
        permissions: { can_void_line_item: true, can_export_client_list: true }
      })
      setLoading(false)
      return
    }

    // TIER 2: Boutique Manager
    let { data: tenantData } = await supabase.from('tenants').select('*').eq('user_id', user.id).maybeSingle()
    
    if (!tenantData) {
      const { data: newTenant } = await supabase.from('tenants').insert([{ business_name: 'New Boutique', user_id: user.id }]).select().single()
      tenantData = newTenant
    }
    
    setTenant(tenantData)
    setActiveStaff({
      role: { name: 'Boutique Manager', tier_level: 2 },
      permissions: { can_void_line_item: true, can_price_override: true }
    })
    setLoading(false)
  }

  // --- 4. TIER 3, 4, & 5 ROUTING (TERMINAL GATEWAY) ---
  const handleTerminalLogin = async (e) => {
    e.preventDefault()
    setIsProcessing(true)

    const { data: tenantData, error: tenantError } = await supabase
      .from('tenants')
      .select('*')
      .eq('store_code', storeCode.toUpperCase())
      .maybeSingle()

    if (tenantError || !tenantData) {
      alert("Invalid Store Code.")
      setIsProcessing(false)
      return
    }

    const { data: staffData, error: staffError } = await supabase
      .from('staff')
      .select(`*, roles (name, tier_level, default_permissions)`)
      .eq('tenant_id', tenantData.id)
      .eq('pin_code', staffPin)
      .eq('is_active', true)
      .maybeSingle()

    if (staffError || !staffData) {
      alert("Invalid Staff PIN.")
      setIsProcessing(false)
      return
    }

    const combinedPermissions = { ...staffData.roles.default_permissions, ...staffData.custom_permissions }

    await supabase.from('terminal_sessions').insert([{ tenant_id: tenantData.id, staff_id: staffData.id }])

    setTenant(tenantData)
    setActiveStaff({
      id: staffData.id,
      name: staffData.full_name,
      role: staffData.roles,
      permissions: combinedPermissions
    })
    setIsProcessing(false)
  }

  // --- 5. SECURE LOGOUT ---
  const handleLogout = async () => {
    if (session) await supabase.auth.signOut()
    
    if (activeStaff?.id && tenant?.id) {
      await supabase.from('terminal_sessions')
        .update({ logout_time: new Date().toISOString() })
        .eq('staff_id', activeStaff.id)
        .is('logout_time', null)
    }

    setSession(null)
    setTenant(null)
    setActiveStaff(null)
    setStaffPin('')
  }

  // ==========================================
  // RENDER: SECURE GATEWAY ENTRANCE
  // ==========================================
  if (loading) return <div className="h-screen bg-[#0f172a] flex items-center justify-center text-[#e2e8f0] font-mono text-sm tracking-widest uppercase">Initializing Security Protocol...</div>

  if (!activeStaff) {
    return (
      <div className="flex h-screen bg-[#0f172a] font-sans text-slate-100 items-center justify-center p-6">
        <div className="w-full max-w-md bg-[#1e293b] border border-[#334155] rounded-xl shadow-2xl overflow-hidden">
          <div className="flex border-b border-[#334155]">
            <button onClick={() => setLoginGateway('management')} className={`flex-1 py-4 font-bold text-xs tracking-widest uppercase ${loginGateway === 'management' ? 'bg-[#3b82f6] text-white' : 'text-slate-500 hover:text-slate-300'}`}>HQ Office</button>
            <button onClick={() => setLoginGateway('terminal')} className={`flex-1 py-4 font-bold text-xs tracking-widest uppercase ${loginGateway === 'terminal' ? 'bg-[#0f172a] text-white' : 'text-slate-500 hover:text-slate-300'}`}>POS Terminal</button>
          </div>
          
          <div className="p-10">
            {loginGateway === 'terminal' ? (
              <form onSubmit={handleTerminalLogin} className="space-y-6">
                <div className="text-center mb-6">
                  <h2 className="text-2xl font-black text-white tracking-tight">Staff Authentication</h2>
                  <p className="text-xs text-slate-400 mt-2">Enter Store Code & Access PIN</p>
                </div>
                <input required type="text" value={storeCode} onChange={e => setStoreCode(e.target.value)} className="w-full px-4 py-4 bg-[#0f172a] border border-[#3b82f6] focus:ring-1 focus:ring-[#3b82f6] rounded-lg outline-none text-white placeholder-slate-600 uppercase font-mono text-center tracking-widest" placeholder="STORE CODE" />
                <input required type="password" value={staffPin} onChange={e => setStaffPin(e.target.value)} className="w-full px-4 py-4 bg-[#0f172a] border border-[#3b82f6] focus:ring-1 focus:ring-[#3b82f6] rounded-lg outline-none text-white placeholder-slate-600 tracking-[0.5em] text-center text-2xl" placeholder="••••" maxLength="6" />
                <button disabled={isProcessing} type="submit" className="w-full bg-[#3b82f6] text-white font-bold py-4 rounded-lg hover:bg-blue-500 transition text-sm tracking-wide uppercase disabled:opacity-50">
                  {isProcessing ? 'Verifying...' : 'Unlock Terminal'}
                </button>
              </form>
            ) : (
              <form onSubmit={async (e) => { e.preventDefault(); setIsProcessing(true); await supabase.auth.signInWithPassword({ email, password }); setIsProcessing(false); }} className="space-y-5">
                <div className="text-center mb-6">
                  <h2 className="text-2xl font-black text-white tracking-tight">Management Portal</h2>
                  <p className="text-xs text-slate-400 mt-2">Tiers 1 & 2 Administrative Access</p>
                </div>
                <input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 bg-[#0f172a] border border-[#334155] rounded-lg outline-none text-white placeholder-slate-500 text-sm" placeholder="Corporate Email" />
                <input required type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 bg-[#0f172a] border border-[#334155] rounded-lg outline-none text-white placeholder-slate-500 text-sm" placeholder="Password" />
                <button disabled={isProcessing} type="submit" className="w-full bg-white text-slate-900 font-bold py-3.5 rounded-lg hover:bg-slate-200 transition mt-2 text-sm tracking-wide">Sign In</button>
              </form>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ==========================================
  // RENDER: ROUTING SWITCHBOARD BASED ON TIER
  // ==========================================
  const currentTier = activeStaff.role.tier_level;

  return (
    <div className="min-h-screen bg-[#f8fafc] font-sans text-slate-900 flex flex-col">
      {/* Universal Header showing Tier and Security Context */}
      <div className="bg-[#0f172a] text-white px-6 py-3 flex justify-between items-center shadow-md z-50">
        <div className="flex items-center gap-4">
          <h1 className="font-black tracking-tight text-lg">{tenant ? tenant.business_name : 'HarminSolutions Global'}</h1>
          <span className="bg-[#3b82f6] text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-blue-400">Tier {currentTier}: {activeStaff.role.name}</span>
          {activeStaff.name && <span className="text-xs text-slate-400">Logged in as: {activeStaff.name}</span>}
        </div>
        <button onClick={handleLogout} className="text-xs font-bold text-red-400 hover:text-white border border-red-900 hover:bg-red-500/20 px-4 py-1.5 rounded transition">Secure Logout</button>
      </div>

      {/* RENDER UI BASED ON TIER */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* TIER 1: SYSTEM ADMIN */}
        {currentTier === 1 && (
          <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 p-8">
            <div className="max-w-7xl mx-auto">
              <div className="mb-10 border-b border-slate-800 pb-6">
                <p className="text-blue-400 font-bold text-xs tracking-widest uppercase mb-1">HarminSolutions Administrator</p>
                <h1 className="text-3xl font-black tracking-tight">Global HQ Console</h1>
              </div>

              <div className="grid grid-cols-3 gap-6 mb-8">
                <div className="bg-[#0f172a] border border-slate-800 p-6 rounded-2xl shadow-lg">
                  <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Active Tenants</p>
                  <p className="text-4xl font-black text-white mt-2">{allTenants.length}</p>
                </div>
                <div className="bg-[#0f172a] border border-slate-800 p-6 rounded-2xl shadow-lg">
                  <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Total Platform Sales</p>
                  <p className="text-4xl font-black text-white mt-2">{platformSales.length}</p>
                </div>
                <div className="bg-[#0f172a] border border-slate-800 p-6 rounded-2xl shadow-lg">
                  <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Gross Processing Volume</p>
                  <p className="text-4xl font-black text-emerald-400 mt-2">RM {platformSales.reduce((sum, s) => sum + s.total_amount, 0).toFixed(2)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-8">
                <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-6 shadow-lg flex flex-col h-[500px]">
                  <h2 className="text-xl font-bold mb-4 text-white">Registered Merchants</h2>
                  <div className="flex-1 space-y-3 overflow-y-auto pr-2">
                    {allTenants.length === 0 ? (
                      <p className="text-sm text-slate-500">No merchants registered yet.</p>
                    ) : (
                      allTenants.map(t => (
                        <div key={t.id} className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
                          <div>
                            <p className="font-bold text-white text-lg">{t.business_name || 'Unnamed Store'}</p>
                            <p className="text-xs text-slate-400 font-mono mt-1">Code: <span className="text-blue-400">{t.store_code || 'PENDING'}</span></p>
                          </div>
                          <div>
                            {t.is_approved ? (
                              <span className="text-xs px-3 py-1.5 rounded-lg font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Approved</span>
                            ) : (
                              <button onClick={() => approveTenant(t.id)} className="text-xs px-4 py-2 rounded-lg font-bold bg-orange-600 text-white hover:bg-orange-500 transition">Approve Merchant</button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-6 shadow-lg flex flex-col h-[500px]">
                  <h2 className="text-xl font-bold mb-4 text-white">Global Sales Audit Trail</h2>
                  <div className="flex-1 space-y-3 overflow-y-auto pr-2">
                    {platformSales.length === 0 ? (
                      <p className="text-slate-500 text-sm">No transactions recorded across the platform yet.</p>
                    ) : (
                      platformSales.map(s => {
                        const merchant = allTenants.find(t => t.id === s.tenant_id);
                        return (
                          <div key={s.id} className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800 text-sm">
                            <div>
                              <p className="font-bold text-white text-base">RM {s.total_amount.toFixed(2)}</p>
                              <p className="text-xs text-slate-400 mt-1">{(merchant && merchant.business_name) || 'Unknown Store'} · {new Date(s.created_at).toLocaleString()}</p>
                            </div>
                            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 bg-slate-800 px-2 py-1 rounded">
                              {s.lhdn_buyer_tin ? 'B2B e-Invoice' : 'B2C Sale'}
                            </span>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TIER 2: BOUTIQUE MANAGER */}
        {currentTier === 2 && (
          <div className="p-10 w-full flex items-center justify-center text-slate-400 font-mono">
            [Boutique Manager Financial Controls Loading...]
          </div>
        )}

        {/* TIER 3 & 4: CLIENTELING TERMINAL (Supervisors & Advisors) */}
        {(currentTier === 3 || currentTier === 4) && (
          <div className="p-10 w-full flex flex-col items-center justify-center bg-white">
            <h2 className="text-3xl font-black mb-4">Clienteling Engine Active</h2>
            <p className="text-slate-500 font-mono text-sm mb-8">Access Level Verified. Permissions Loaded.</p>
            
            <div className="bg-slate-50 border border-slate-200 p-6 rounded-xl w-full max-w-md">
              <h3 className="font-bold text-sm uppercase tracking-wider text-slate-500 mb-4 border-b border-slate-200 pb-2">Active Security Profile (JSONB)</h3>
              <pre className="text-xs text-blue-600 bg-blue-50 p-4 rounded border border-blue-100 overflow-x-auto">
                {JSON.stringify(activeStaff.permissions, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* TIER 5: INVENTORY / STOCKROOM */}
        {currentTier === 5 && (
          <div className="p-10 w-full flex items-center justify-center text-slate-400 font-mono">
            [Inventory Management & PO System Loading...]
          </div>
        )}
      </div>
    </div>
  )
}