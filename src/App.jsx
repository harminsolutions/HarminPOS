import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export default function App() {
  // Global & Routing State
  const [session, setSession] = useState(null)
  const [tenant, setTenant] = useState(null)
  const [activeStaff, setActiveStaff] = useState(null)
  const [loading, setLoading] = useState(true)
  
  // Gateways
  const [loginGateway, setLoginGateway] = useState('management')
  
  // Auth Form State
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [storeCode, setStoreCode] = useState('')
  const [staffPin, setStaffPin] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)

  // Navigation State
  const [activeTab, setActiveTab] = useState('overview')

  // Tier 1 (System Admin) State
  const [allTenants, setAllTenants] = useState([])
  const [platformSales, setPlatformSales] = useState([])
  
  // Tier 2 (Boutique Manager) State
  const [products, setProducts] = useState([])
  const [salesData, setSalesData] = useState([])
  const [staffList, setStaffList] = useState([])
  const [roles, setRoles] = useState([])
  const [newProduct, setNewProduct] = useState({ name: '', price: '', cost_price: '', image_url: '', category: 'Retail' })
  const [newStaff, setNewStaff] = useState({ full_name: '', pin_code: '', role_id: '' })

  const SYSTEM_ADMIN_EMAIL = 'harminsolutions96@gmail.com'
  const isReportDay = new Date().getDate() === 30 // Strict 30th of the month rule

  // --- 1. INITIALIZATION ---
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
      } else { 
        setActiveStaff((prevStaff) => {
          if (prevStaff?.role?.tier_level <= 2) {
            setTenant(null)
            return null
          }
          return prevStaff
        })
        setLoading(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // --- 2. DATA FETCHING ---
  const fetchPlatformOverview = async () => {
    const { data: tenantsData } = await supabase.from('tenants').select('*').order('created_at', { ascending: false })
    const { data: salesData } = await supabase.from('sales').select('*').order('created_at', { ascending: false })
    setAllTenants(tenantsData || [])
    setPlatformSales(salesData || [])
  }

  const fetchTenantData = async (tenantId) => {
    const [prodRes, salesRes, staffRes, rolesRes] = await Promise.all([
      supabase.from('products').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      supabase.from('sales').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      supabase.from('staff').select('*, roles(name, tier_level)').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      supabase.from('roles').select('*').gte('tier_level', 3).order('tier_level', { ascending: true }) // Only fetch assignable roles
    ])
    
    if (prodRes.data) setProducts(prodRes.data)
    if (salesRes.data) setSalesData(salesRes.data)
    if (staffRes.data) setStaffList(staffRes.data)
    if (rolesRes.data) {
      setRoles(rolesRes.data)
      if (rolesRes.data.length > 0) setNewStaff(prev => ({ ...prev, role_id: rolesRes.data[0].id }))
    }
  }

  // --- 3. AUTHENTICATION ROUTING ---
  const handleTier1And2Auth = async (user) => {
    setLoading(true)
    
    // TIER 1
    if (user.email === SYSTEM_ADMIN_EMAIL) {
      await fetchPlatformOverview()
      setActiveStaff({ role: { name: 'System Admin', tier_level: 1 }, permissions: { can_void_line_item: true } })
      setLoading(false)
      return
    }

    // TIER 2
    let { data: tenantData } = await supabase.from('tenants').select('*').eq('user_id', user.id).maybeSingle()
    
    if (!tenantData) {
      const { data: newTenant } = await supabase.from('tenants').insert([{ business_name: 'New Boutique', user_id: user.id }]).select().single()
      tenantData = newTenant
    }
    
    setTenant(tenantData)
    await fetchTenantData(tenantData.id)
    setActiveStaff({ role: { name: 'Boutique Manager', tier_level: 2 }, permissions: { can_void_line_item: true } })
    setLoading(false)
  }

  const handleTerminalLogin = async (e) => {
    e.preventDefault()
    setIsProcessing(true)

    const { data: tenantData } = await supabase.from('tenants').select('*').eq('store_code', storeCode.toUpperCase()).maybeSingle()
    if (!tenantData) { alert("Invalid Store Code."); setIsProcessing(false); return; }

    const { data: staffData } = await supabase.from('staff').select(`*, roles (name, tier_level, default_permissions)`).eq('tenant_id', tenantData.id).eq('pin_code', staffPin).eq('is_active', true).maybeSingle()
    if (!staffData) { alert("Invalid Staff PIN."); setIsProcessing(false); return; }

    const combinedPermissions = { ...staffData.roles.default_permissions, ...staffData.custom_permissions }
    await supabase.from('terminal_sessions').insert([{ tenant_id: tenantData.id, staff_id: staffData.id }])

    setTenant(tenantData)
    setActiveStaff({ id: staffData.id, name: staffData.full_name, role: staffData.roles, permissions: combinedPermissions })
    setIsProcessing(false)
  }

  const handleLogout = async () => {
    if (session) await supabase.auth.signOut()
    if (activeStaff?.id && tenant?.id) {
      await supabase.from('terminal_sessions').update({ logout_time: new Date().toISOString() }).eq('staff_id', activeStaff.id).is('logout_time', null)
    }
    setSession(null)
    setTenant(null)
    setActiveStaff(null)
    setStaffPin('')
  }

  // --- 4. TIER 1 ACTIONS ---
  const approveTenant = async (tenantId) => {
    await supabase.from('tenants').update({ is_approved: true }).eq('id', tenantId)
    fetchPlatformOverview()
  }

  // --- 5. TIER 2 ACTIONS ---
  const handleAddProduct = async (e) => {
    e.preventDefault()
    setIsProcessing(true)
    await supabase.from('products').insert([{ 
      tenant_id: tenant.id, name: newProduct.name, price: parseFloat(newProduct.price), cost_price: parseFloat(newProduct.cost_price || 0), image_url: newProduct.image_url, category: newProduct.category 
    }])
    setNewProduct({ name: '', price: '', cost_price: '', image_url: '', category: 'Retail' })
    fetchTenantData(tenant.id)
    setIsProcessing(false)
  }

  const deleteProduct = async (id) => {
    if (window.confirm("Delete this product?")) {
      await supabase.from('products').delete().eq('id', id)
      fetchTenantData(tenant.id)
    }
  }

  const handleAddStaff = async (e) => {
    e.preventDefault()
    setIsProcessing(true)
    const { error } = await supabase.from('staff').insert([{
      tenant_id: tenant.id, full_name: newStaff.full_name, pin_code: newStaff.pin_code, role_id: newStaff.role_id
    }])
    if (error) alert(error.message)
    else {
      setNewStaff({ full_name: '', pin_code: '', role_id: roles[0]?.id || '' })
      fetchTenantData(tenant.id)
    }
    setIsProcessing(false)
  }

  const toggleStaffStatus = async (id, currentStatus) => {
    await supabase.from('staff').update({ is_active: !currentStatus }).eq('id', id)
    fetchTenantData(tenant.id)
  }

  const downloadCSV = () => {
    const headers = "Transaction ID,Date,Subtotal (RM),SST (RM),Total (RM),Net Profit (RM)\n"
    const rows = salesData.map(s => `${s.id.split('-')[0]},${new Date(s.created_at).toLocaleDateString()},${s.subtotal},${s.sst_amount},${s.total_amount},${s.total_profit}`).join("\n")
    const blob = new Blob([headers + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Monthly_Report_${tenant.business_name.replace(/\s+/g, '_')}.csv`
    a.click()
  }

  // ==========================================
  // RENDER: GATEWAY
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

  const currentTier = activeStaff.role.tier_level;

  return (
    <div className="min-h-screen bg-[#f8fafc] font-sans text-slate-900 flex flex-col">
      <div className="bg-[#0f172a] text-white px-6 py-3 flex justify-between items-center shadow-md z-50">
        <div className="flex items-center gap-4">
          <h1 className="font-black tracking-tight text-lg">{tenant ? tenant.business_name : 'HarminSolutions Global'}</h1>
          <span className="bg-[#3b82f6] text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-blue-400">Tier {currentTier}: {activeStaff.role.name}</span>
          {activeStaff.name && <span className="text-xs text-slate-400">Logged in as: {activeStaff.name}</span>}
        </div>
        <button onClick={handleLogout} className="text-xs font-bold text-red-400 hover:text-white border border-red-900 hover:bg-red-500/20 px-4 py-1.5 rounded transition">Secure Logout</button>
      </div>

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
                <div className="bg-[#0f172a] border border-slate-800 p-6 rounded-2xl shadow-lg"><p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Active Tenants</p><p className="text-4xl font-black text-white mt-2">{allTenants.length}</p></div>
                <div className="bg-[#0f172a] border border-slate-800 p-6 rounded-2xl shadow-lg"><p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Total Platform Sales</p><p className="text-4xl font-black text-white mt-2">{platformSales.length}</p></div>
                <div className="bg-[#0f172a] border border-slate-800 p-6 rounded-2xl shadow-lg"><p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Gross Processing Volume</p><p className="text-4xl font-black text-emerald-400 mt-2">RM {platformSales.reduce((sum, s) => sum + s.total_amount, 0).toFixed(2)}</p></div>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-6 shadow-lg flex flex-col h-[500px]">
                  <h2 className="text-xl font-bold mb-4 text-white">Registered Merchants</h2>
                  <div className="flex-1 space-y-3 overflow-y-auto pr-2">
                    {allTenants.length === 0 ? <p className="text-sm text-slate-500">No merchants registered.</p> : allTenants.map(t => (
                      <div key={t.id} className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
                        <div><p className="font-bold text-white text-lg">{t.business_name || 'Unnamed Store'}</p><p className="text-xs text-slate-400 font-mono mt-1">Code: <span className="text-blue-400">{t.store_code || 'PENDING'}</span></p></div>
                        <div>{t.is_approved ? <span className="text-xs px-3 py-1.5 rounded-lg font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Approved</span> : <button onClick={() => approveTenant(t.id)} className="text-xs px-4 py-2 rounded-lg font-bold bg-orange-600 text-white hover:bg-orange-500 transition">Approve</button>}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TIER 2: BOUTIQUE MANAGER */}
        {currentTier === 2 && (
          <div className="flex w-full h-full bg-slate-50">
            <div className="w-64 bg-white border-r border-slate-200 flex flex-col shadow-sm">
              <div className="p-6 border-b border-slate-100 bg-slate-900 text-white">
                <h2 className="font-black text-xl tracking-tight leading-tight">{tenant?.business_name}</h2>
                <div className="mt-3"><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Store Code:</span> <span className="text-xs bg-slate-800 px-2 py-1 rounded border border-slate-700 font-mono text-blue-400">{tenant?.store_code || 'PENDING'}</span></div>
              </div>
              <div className="flex-1 p-4 space-y-1">
                <button onClick={() => setActiveTab('overview')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm ${activeTab === 'overview' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50'}`}>Performance Analytics</button>
                <button onClick={() => setActiveTab('staff')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm ${activeTab === 'staff' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50'}`}>Staff & Security</button>
                <button onClick={() => setActiveTab('inventory')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm ${activeTab === 'inventory' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50'}`}>Inventory Control</button>
                <button onClick={() => setActiveTab('reports')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm flex justify-between ${activeTab === 'reports' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50'}`}>End of Month Reports {isReportDay && <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5"></span>}</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-10 bg-slate-50 relative">
              {!tenant?.is_approved && (
                <div className="bg-orange-100 border border-orange-300 text-orange-800 p-4 rounded-xl mb-8 font-medium text-sm flex justify-between items-center">
                  <span>⚠️ Your merchant account is in <b>Pending Verification</b> mode.</span>
                  <button className="bg-orange-800 text-white px-4 py-1.5 rounded-lg text-xs font-bold">Contact HQ</button>
                </div>
              )}

              {activeTab === 'overview' && (
                <div>
                  <h1 className="text-3xl font-black mb-8 tracking-tight">Financial Overview</h1>
                  <div className="grid grid-cols-3 gap-6">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"><p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Total Gross Sales</p><p className="text-3xl font-black text-slate-900">RM {salesData.reduce((s, a) => s + a.total_amount, 0).toFixed(2)}</p></div>
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"><p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Total Net Profit</p><p className="text-3xl font-black text-emerald-600">RM {salesData.reduce((s, a) => s + (a.total_profit || 0), 0).toFixed(2)}</p></div>
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"><p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Total Tax (SST)</p><p className="text-3xl font-black text-slate-900">RM {salesData.reduce((s, a) => s + a.sst_amount, 0).toFixed(2)}</p></div>
                  </div>
                </div>
              )}

              {activeTab === 'staff' && (
                <div>
                  <h1 className="text-3xl font-black mb-8 tracking-tight">Staff & Security Management</h1>
                  <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm mb-8">
                    <h3 className="font-bold mb-5 text-lg">Provision New Terminal Access</h3>
                    <form onSubmit={handleAddStaff} className="grid grid-cols-4 gap-4 items-end">
                      <div className="col-span-1"><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Full Name</label><input required type="text" value={newStaff.full_name} onChange={e => setNewStaff({...newStaff, full_name: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-500" /></div>
                      <div className="col-span-1"><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Access PIN (6-Digit)</label><input required type="password" maxLength="6" value={newStaff.pin_code} onChange={e => setNewStaff({...newStaff, pin_code: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-500 font-mono tracking-widest" /></div>
                      <div className="col-span-1"><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Security Role</label>
                        <select required value={newStaff.role_id} onChange={e => setNewStaff({...newStaff, role_id: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm outline-none bg-white">
                          {roles.map(r => <option key={r.id} value={r.id}>Tier {r.tier_level}: {r.name}</option>)}
                        </select>
                      </div>
                      <div className="col-span-1"><button disabled={isProcessing || !tenant?.is_approved} type="submit" className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 text-sm disabled:bg-slate-400">Generate Access</button></div>
                    </form>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200"><tr className="text-slate-500"><th className="p-4 font-bold">Staff Name</th><th className="p-4 font-bold">Role Hierarchy</th><th className="p-4 font-bold">Status</th><th className="p-4 font-bold text-right">Access Control</th></tr></thead>
                      <tbody>
                        {staffList.length === 0 ? <tr><td colSpan="4" className="p-6 text-center text-slate-500">No staff provisioned.</td></tr> : staffList.map(s => (
                          <tr key={s.id} className="border-b border-slate-100">
                            <td className="p-4 font-bold">{s.full_name}</td>
                            <td className="p-4"><span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md text-xs font-bold border border-blue-200">Tier {s.roles.tier_level}: {s.roles.name}</span></td>
                            <td className="p-4">{s.is_active ? <span className="text-emerald-600 font-bold text-xs">Active</span> : <span className="text-red-500 font-bold text-xs">Revoked</span>}</td>
                            <td className="p-4 text-right"><button onClick={() => toggleStaffStatus(s.id, s.is_active)} className="text-slate-600 hover:text-slate-900 font-bold text-xs border border-slate-300 px-3 py-1.5 rounded-lg">{s.is_active ? 'Revoke Access' : 'Restore Access'}</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'inventory' && (
                <div>
                  <h1 className="text-3xl font-black mb-8 tracking-tight">Inventory Control</h1>
                  <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm mb-8 relative overflow-hidden">
                    <h3 className="font-bold mb-5 text-lg">Register New Product</h3>
                    <form onSubmit={handleAddProduct} className="grid grid-cols-4 gap-4 items-end">
                      <div className="col-span-2"><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Product Name</label><input required type="text" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm outline-none" /></div>
                      <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Category</label><select value={newProduct.category} onChange={e => setNewProduct({...newProduct, category: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm bg-white"><option>Retail</option><option>Beverages</option></select></div>
                      <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Image URL</label><input type="text" value={newProduct.image_url} onChange={e => setNewProduct({...newProduct, image_url: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm outline-none" /></div>
                      <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cost Price (RM)</label><input required type="number" step="0.01" value={newProduct.cost_price} onChange={e => setNewProduct({...newProduct, cost_price: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm outline-none" /></div>
                      <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Selling Price (RM)</label><input required type="number" step="0.01" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm outline-none" /></div>
                      <div className="col-span-2"><button disabled={isProcessing || !tenant?.is_approved} type="submit" className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 text-sm disabled:bg-slate-400">Save to Register</button></div>
                    </form>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200"><tr className="text-slate-500"><th className="p-4 font-bold">Product</th><th className="p-4 font-bold">Cost</th><th className="p-4 font-bold">Price</th><th className="p-4 font-bold text-right">Action</th></tr></thead>
                      <tbody>
                        {products.length === 0 ? <tr><td colSpan="4" className="p-6 text-center text-slate-500">No products added.</td></tr> : products.map(p => (
                          <tr key={p.id} className="border-b border-slate-100"><td className="p-4 font-medium flex items-center gap-3">{p.image_url ? <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover" /> : <div className="w-8 h-8 rounded bg-slate-200"></div>}{p.name}</td><td className="p-4 text-slate-500">RM {(p.cost_price || 0).toFixed(2)}</td><td className="p-4 font-bold text-blue-600">RM {p.price.toFixed(2)}</td><td className="p-4 text-right"><button onClick={() => deleteProduct(p.id)} className="text-red-500 hover:text-red-700 font-bold text-xs">Delete</button></td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'reports' && (
                <div>
                  <h1 className="text-3xl font-black mb-4 tracking-tight">End of Month Reports</h1>
                  {isReportDay ? (
                    <div className="bg-emerald-50 border border-emerald-200 p-8 rounded-2xl shadow-sm">
                      <h3 className="text-emerald-900 font-black text-xl mb-2">Reports are ready for download!</h3>
                      <button onClick={downloadCSV} className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:bg-emerald-700 transition">Download Excel / CSV</button>
                    </div>
                  ) : (
                    <div className="bg-white border border-slate-200 p-10 rounded-2xl shadow-sm text-center">
                      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-2xl mb-4 mx-auto">🔒</div>
                      <h3 className="text-slate-900 font-black text-xl mb-2">Vault Locked</h3>
                      <p className="text-slate-500 text-sm">Please return on the 30th of the month to extract your official P&L statements.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TIER 3 & 4: CLIENTELING TERMINAL */}
        {(currentTier === 3 || currentTier === 4) && (
          <div className="p-10 w-full flex flex-col items-center justify-center bg-white">
            <h2 className="text-3xl font-black mb-4">Clienteling Engine Active</h2>
            <p className="text-slate-500 font-mono text-sm mb-8">Access Level Verified. Permissions Loaded.</p>
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