import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export default function App() {
  // Global State
  const [session, setSession] = useState(null)
  const [tenant, setTenant] = useState(null)
  const [loading, setLoading] = useState(true)
  
  // Auth State
  const [loginGateway, setLoginGateway] = useState('management') // 'management' or 'terminal'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [storeCode, setStoreCode] = useState('')
  const [terminalPin, setTerminalPin] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  
  // Routing State ('owner', 'merchant_dashboard', 'pos_terminal')
  const [activeRole, setActiveRole] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')

  // Data State
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [newProduct, setNewProduct] = useState({ name: '', price: '', cost_price: '', image_url: '', category: 'Beverages' })
  const [receiptData, setReceiptData] = useState(null)
  const [salesData, setSalesData] = useState([])
  const [showLhdn, setShowLhdn] = useState(false)
  const [tin, setTin] = useState('')

  // Platform Analytics State
  const [allTenants, setAllTenants] = useState([])
  const [platformSales, setPlatformSales] = useState([])

  const OWNER_EMAIL = 'harminsolutions96@gmail.com'
  const isReportDay = new Date().getDate() === 30 // Strict 30th of the month rule

  // --- INITIALIZATION ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) initializeApp(session.user)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        initializeApp(session.user)
      } else if (activeRole !== 'pos_terminal') { 
        // Do not reset if cashier is actively logged in via Terminal PIN
        setTenant(null)
        setActiveRole(null)
        setLoading(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [activeRole])

  const initializeApp = async (user) => {
    setLoading(true)
    if (user.email === OWNER_EMAIL) {
      await fetchPlatformOverview()
      setActiveRole('owner')
      setLoading(false)
      return
    }

    let { data } = await supabase.from('tenants').select('*').eq('user_id', user.id).maybeSingle()
    
    // Auto-provision tenant if first login
    if (!data) {
      const { data: newTenant } = await supabase
        .from('tenants')
        .insert([{ business_name: 'My New Store', user_id: user.id }])
        .select()
        .single()
      data = newTenant
    }
    
    setTenant(data)
    if (data) {
      fetchProducts(data.id)
      fetchSales(data.id)
    }
    setActiveRole('merchant_dashboard')
    setLoading(false)
  }

  // --- DATA FETCHING ---
  const fetchPlatformOverview = async () => {
    const { data: tenantsData } = await supabase.from('tenants').select('*').order('created_at', { ascending: false })
    const { data: salesData } = await supabase.from('sales').select('*').order('created_at', { ascending: false })
    setAllTenants(tenantsData || [])
    setPlatformSales(salesData || [])
  }

  const fetchProducts = async (tenantId) => {
    const { data } = await supabase.from('products').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false })
    setProducts(data || [])
  }

  const fetchSales = async (tenantId) => {
    const { data } = await supabase.from('sales').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false })
    setSalesData(data || [])
  }

  // --- AUTHENTICATION ACTIONS ---
  const handleManagementLogin = async (e) => {
    e.preventDefault()
    setIsProcessing(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) alert("Login Failed: " + error.message)
    setIsProcessing(false)
  }

  const handleTerminalLogin = async (e) => {
    e.preventDefault()
    setIsProcessing(true)
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('store_code', storeCode.toUpperCase())
      .eq('terminal_pin', terminalPin)
      .maybeSingle()

    if (error || !data) {
      alert("Invalid Store Code or Terminal PIN.")
    } else {
      setTenant(data)
      fetchProducts(data.id)
      setActiveRole('pos_terminal')
    }
    setIsProcessing(false)
  }

  const handleLogout = async () => {
    if (session) await supabase.auth.signOut()
    setSession(null)
    setTenant(null)
    setActiveRole(null)
    setStoreCode('')
    setTerminalPin('')
  }

  // --- POS TERMINAL ACTIONS ---
  const addToCart = (product) => {
    const existing = cart.find(item => item.id === product.id)
    if (existing) setCart(cart.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item))
    else setCart([...cart, { ...product, qty: 1 }])
  }

  const updateQty = (id, delta) => {
    setCart(cart.map(item => {
      if (item.id === id) {
        const newQty = item.qty + delta
        return newQty > 0 ? { ...item, qty: newQty } : null
      }
      return item
    }).filter(Boolean))
  }

  const handleCheckout = async () => {
    setIsProcessing(true)
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0)
    const totalProfit = cart.reduce((sum, item) => sum + ((item.price - (item.cost_price || 0)) * item.qty), 0)
    const sst = subtotal * 0.06
    const total = subtotal + sst

    const { data: salesOutput, error } = await supabase
      .from('sales')
      .insert([{ 
        tenant_id: tenant.id, 
        subtotal, 
        sst_amount: sst, 
        total_amount: total, 
        total_profit: totalProfit, 
        lhdn_buyer_tin: showLhdn ? tin : null 
      }])
      .select()

    if (!error && salesOutput) {
      setReceiptData({ 
        items: [...cart], 
        subtotal, 
        sst, 
        total, 
        tin: showLhdn ? tin : null, 
        date: new Date().toLocaleString(), 
        receiptNo: salesOutput[0].id.split('-')[0].toUpperCase() 
      })
      setCart([])
      setTin('')
      setShowLhdn(false)
    } else {
      alert("Transaction failed: " + (error?.message || 'Unknown error'))
    }
    setIsProcessing(false)
  }

  // --- MERCHANT DASHBOARD ACTIONS ---
  const handleAddProduct = async (e) => {
    e.preventDefault()
    setIsProcessing(true)
    const { error } = await supabase.from('products').insert([{ 
      tenant_id: tenant.id, 
      name: newProduct.name, 
      price: parseFloat(newProduct.price), 
      cost_price: parseFloat(newProduct.cost_price || 0),
      image_url: newProduct.image_url,
      category: newProduct.category 
    }])
    
    if (error) {
      alert("Error adding product: " + error.message)
    } else {
      setNewProduct({ name: '', price: '', cost_price: '', image_url: '', category: 'Beverages' })
      fetchProducts(tenant.id)
    }
    setIsProcessing(false)
  }

  const deleteProduct = async (id) => {
    if (window.confirm("Are you sure you want to delete this product?")) {
      await supabase.from('products').delete().eq('id', id)
      fetchProducts(tenant.id)
    }
  }

  const downloadCSV = () => {
    const headers = "Transaction ID,Date,Subtotal (RM),SST (RM),Total (RM),Net Profit (RM),B2B TIN\n"
    const rows = salesData.map(s => `${s.id.split('-')[0]},${new Date(s.created_at).toLocaleDateString()},${s.subtotal},${s.sst_amount},${s.total_amount},${s.total_profit},${s.lhdn_buyer_tin || 'N/A'}`).join("\n")
    const blob = new Blob([headers + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Monthly_Report_${tenant.business_name.replace(/\s+/g, '_')}.csv`
    a.click()
  }

  const downloadPDF = () => {
    const printWindow = window.open('', '', 'height=800,width=1000')
    const html = `
      <html><head><title>Monthly Sales Report</title>
      <style>body{font-family:sans-serif; padding:40px;} table{width:100%; border-collapse:collapse; margin-top:20px;} th,td{border:1px solid #ddd; padding:10px; text-align:left;} th{background:#f1f5f9;}</style>
      </head><body>
      <h2>${tenant.business_name} - Monthly Financial Report</h2>
      <p>Generated strictly on: ${new Date().toLocaleDateString()}</p>
      <table>
        <thead><tr><th>Receipt ID</th><th>Date</th><th>Total Revenue</th><th>Net Profit</th></tr></thead>
        <tbody>${salesData.map(s => `<tr><td>${s.id.split('-')[0].toUpperCase()}</td><td>${new Date(s.created_at).toLocaleDateString()}</td><td>RM ${s.total_amount.toFixed(2)}</td><td>RM${(s.total_profit || 0).toFixed(2)}</td></tr>`).join('')}</tbody>
      </table>
      </body></html>
    `
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.print()
  }

  // ==========================================
  // RENDER: 1. DUAL-GATEWAY LOGIN
  // ==========================================
  if (loading) return <div className="h-screen bg-slate-900 flex items-center justify-center text-white font-mono">Initializing System...</div>

  if (!activeRole) {
    return (
      <div className="flex h-screen bg-slate-950 font-sans text-slate-100 items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-900/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-900/20 rounded-full blur-3xl pointer-events-none"></div>

        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden relative z-10">
          <div className="flex border-b border-slate-800">
            <button onClick={() => setLoginGateway('management')} className={`flex-1 py-4 font-bold text-sm tracking-wide ${loginGateway === 'management' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}>MANAGEMENT HQ</button>
            <button onClick={() => setLoginGateway('terminal')} className={`flex-1 py-4 font-bold text-sm tracking-wide ${loginGateway === 'terminal' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>POS TERMINAL</button>
          </div>
          
          <div className="p-10">
            {loginGateway === 'management' ? (
              <form onSubmit={handleManagementLogin} className="space-y-5">
                <div className="text-center mb-6">
                  <h2 className="text-2xl font-black text-white">Back-Office Login</h2>
                  <p className="text-xs text-slate-400 mt-1">For Platform Owners & Merchants</p>
                </div>
                <input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl outline-none text-white placeholder-slate-500" placeholder="Admin Email" />
                <input required type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl outline-none text-white placeholder-slate-500" placeholder="Password" />
                <button disabled={isProcessing} type="submit" className="w-full bg-white text-slate-900 font-bold py-3.5 rounded-xl hover:bg-slate-200 transition mt-2">Sign In</button>
              </form>
            ) : (
              <form onSubmit={handleTerminalLogin} className="space-y-5">
                <div className="text-center mb-6">
                  <h2 className="text-2xl font-black text-white">Cashier Terminal</h2>
                  <p className="text-xs text-slate-400 mt-1">Locked Register Environment</p>
                </div>
                <input required type="text" value={storeCode} onChange={e => setStoreCode(e.target.value)} className="w-full px-4 py-3 bg-slate-950 border border-blue-900 focus:border-blue-500 rounded-xl outline-none text-white placeholder-slate-500 uppercase font-mono" placeholder="Store Code (e.g. HP-XXXXX)" />
                <input required type="password" value={terminalPin} onChange={e => setTerminalPin(e.target.value)} className="w-full px-4 py-3 bg-slate-950 border border-blue-900 focus:border-blue-500 rounded-xl outline-none text-white placeholder-slate-500 tracking-widest text-center text-2xl" placeholder="••••" maxLength="6" />
                <button disabled={isProcessing} type="submit" className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 transition mt-2">Unlock Register</button>
              </form>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ==========================================
  // RENDER: 2. TIER 1 - GLOBAL HQ
  // ==========================================
  if (activeRole === 'owner') {
    const totalPlatformRevenue = platformSales.reduce((sum, s) => sum + s.total_amount, 0)

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-8 font-sans">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-10 border-b border-slate-800 pb-6">
            <div>
              <p className="text-blue-400 font-bold text-xs tracking-widest uppercase mb-1">HarminSolutions Administrator</p>
              <h1 className="text-3xl font-black tracking-tight">Global HQ Console</h1>
            </div>
            <button onClick={handleLogout} className="bg-red-900/40 text-red-400 border border-red-900 px-6 py-2.5 rounded-lg font-bold hover:bg-red-800/60 transition text-sm">
              Terminate Session
            </button>
          </div>

          <div className="grid grid-cols-3 gap-6 mb-8">
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-lg">
              <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Active Tenants</p>
              <p className="text-4xl font-black text-white mt-2">{allTenants.length}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-lg">
              <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Total Platform Sales</p>
              <p className="text-4xl font-black text-white mt-2">{platformSales.length}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-lg">
              <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Gross Processing Volume</p>
              <p className="text-4xl font-black text-emerald-400 mt-2">RM {totalPlatformRevenue.toFixed(2)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg">
              <h2 className="text-xl font-bold mb-4 text-white">Registered Merchants</h2>
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                {allTenants.length === 0 ? (
                  <p className="text-sm text-slate-500">No merchants registered yet.</p>
                ) : (
                  allTenants.map(t => (
                    <div key={t.id} className="flex justify-between items-center bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
                      <div>
                        <p className="font-bold text-white">{t.business_name || 'Unnamed Store'}</p>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">Code: {t.store_code || 'PENDING'} | PIN: {t.terminal_pin || '----'}</p>
                      </div>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${t.is_approved ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
                        {t.is_approved ? 'Approved' : 'Pending Verification'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg">
              <h2 className="text-xl font-bold mb-4 text-white">Global Sales Feed</h2>
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                {platformSales.length === 0 ? (
                  <p className="text-slate-500 text-sm">No transactions recorded across the platform yet.</p>
                ) : (
                  platformSales.map(s => {
                    const merchant = allTenants.find(t => t.id === s.tenant_id);
                    return (
                      <div key={s.id} className="flex justify-between items-center bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 text-sm">
                        <div>
                          <p className="font-bold text-white">RM {s.total_amount.toFixed(2)}</p>
                          <p className="text-xs text-slate-400">{(merchant && merchant.business_name) || 'Unknown Store'} · {new Date(s.created_at).toLocaleTimeString()}</p>
                        </div>
                        <span className="text-xs font-mono text-slate-500">{s.lhdn_buyer_tin ? 'B2B e-Invoice' : 'B2C Sale'}</span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ==========================================
  // RENDER: 3. TIER 2 - MERCHANT BACK-OFFICE
  // ==========================================
  if (activeRole === 'merchant_dashboard') {
    return (
      <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
        <div className="w-64 bg-white border-r border-slate-200 flex flex-col z-20 shadow-sm">
          <div className="p-6 border-b border-slate-100 bg-slate-900 text-white">
            <h2 className="font-black text-xl tracking-tight leading-tight">{tenant.business_name}</h2>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Store Code:</span>
              <span className="text-xs bg-slate-800 px-2 py-1 rounded border border-slate-700 font-mono text-blue-400">{tenant.store_code || 'PENDING'}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Terminal PIN:</span>
              <span className="text-xs bg-slate-800 px-2 py-1 rounded border border-slate-700 font-mono text-emerald-400">{tenant.terminal_pin || '1234'}</span>
            </div>
          </div>
          <div className="flex-1 p-4 space-y-1">
            <button onClick={() => setActiveTab('overview')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm ${activeTab === 'overview' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50'}`}>Performance Analytics</button>
            <button onClick={() => setActiveTab('inventory')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm ${activeTab === 'inventory' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50'}`}>Inventory Control</button>
            <button onClick={() => setActiveTab('reports')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm flex justify-between ${activeTab === 'reports' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50'}`}>
              End of Month Reports {isReportDay && <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5"></span>}
            </button>
            <button onClick={() => setActiveTab('settings')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm ${activeTab === 'settings' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50'}`}>Store Settings & LHDN</button>
          </div>
          <div className="p-4 border-t border-slate-100">
            <button onClick={handleLogout} className="w-full bg-white border border-slate-300 text-slate-700 px-4 py-3 rounded-lg font-bold text-sm hover:bg-slate-50 transition">Log Out</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-10 bg-slate-50 relative">
          {!tenant.is_approved && (
            <div className="bg-orange-100 border border-orange-300 text-orange-800 p-4 rounded-xl mb-8 font-medium text-sm flex items-center justify-between shadow-sm">
              <span>⚠️ Your merchant account is strictly in <b>Pending Verification</b> mode. Core features are restricted.</span>
              <button className="bg-orange-800 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-orange-900 transition">Contact HarminSolutions HQ</button>
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

          {activeTab === 'inventory' && (
            <div>
              <h1 className="text-3xl font-black mb-8 tracking-tight">Inventory Control</h1>
              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm mb-8 relative overflow-hidden">
                {!tenant.is_approved && <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center"><div className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-xl flex items-center gap-2">🔒 Inventory addition restricted pending HQ approval</div></div>}
                <h3 className="font-bold mb-5 text-lg">Register New Product</h3>
                <form onSubmit={handleAddProduct} className="grid grid-cols-4 gap-4 items-end">
                  <div className="col-span-2"><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Product Name</label><input required type="text" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-500" /></div>
                  <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Image URL (Optional)</label><input type="text" value={newProduct.image_url} onChange={e => setNewProduct({...newProduct, image_url: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-500" placeholder="https://..." /></div>
                  <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Category</label><select value={newProduct.category} onChange={e => setNewProduct({...newProduct, category: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm outline-none bg-white"><option>Beverages</option><option>Meals</option><option>Pastries</option><option>Retail</option></select></div>
                  <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cost Price (RM)</label><input required type="number" step="0.01" value={newProduct.cost_price} onChange={e => setNewProduct({...newProduct, cost_price: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-500" /></div>
                  <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Selling Price (RM)</label><input required type="number" step="0.01" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-500" /></div>
                  <div className="col-span-2"><button disabled={isProcessing} type="submit" className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 text-sm disabled:bg-slate-400">{isProcessing ? 'Saving...' : 'Save to Register'}</button></div>
                </form>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200"><tr className="text-slate-500"><th className="p-4 font-bold">Product</th><th className="p-4 font-bold">Cost</th><th className="p-4 font-bold">Price</th><th className="p-4 font-bold text-right">Action</th></tr></thead>
                  <tbody>
                    {products.length === 0 ? (
                      <tr><td colSpan="4" className="p-6 text-center text-slate-500">No products added yet.</td></tr>
                    ) : (
                      products.map(p => (
                        <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                          <td className="p-4 font-medium flex items-center gap-3">
                            {p.image_url ? <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover" /> : <div className="w-8 h-8 rounded bg-slate-200"></div>}
                            {p.name}
                          </td>
                          <td className="p-4 text-slate-500">RM {(p.cost_price || 0).toFixed(2)}</td>
                          <td className="p-4 font-bold text-blue-600">RM {p.price.toFixed(2)}</td>
                          <td className="p-4 text-right"><button onClick={() => deleteProduct(p.id)} className="text-red-500 hover:text-red-700 font-bold text-xs">Delete</button></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'reports' && (
            <div>
              <h1 className="text-3xl font-black mb-4 tracking-tight">End of Month Reports</h1>
              <p className="text-slate-500 mb-8 max-w-2xl">To ensure accurate accounting and prevent premature data manipulation, compiled financial reports are strictly available for extraction on the 30th of each calendar month per HarminSolutions platform protocol.</p>
              
              {isReportDay ? (
                <div className="bg-emerald-50 border border-emerald-200 p-8 rounded-2xl shadow-sm">
                  <h3 className="text-emerald-900 font-black text-xl mb-2">Reports are ready for download!</h3>
                  <p className="text-emerald-700 text-sm mb-6">Your data for the month is finalized and ready for extraction.</p>
                  <div className="flex gap-4">
                    <button onClick={downloadCSV} className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:bg-emerald-700 transition flex items-center gap-2">Download Excel / CSV</button>
                    <button onClick={downloadPDF} className="bg-white text-emerald-700 border border-emerald-200 px-6 py-3 rounded-xl font-bold shadow-sm hover:bg-emerald-100 transition">Print PDF Report</button>
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 p-10 rounded-2xl shadow-sm text-center flex flex-col items-center justify-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-2xl mb-4">🔒</div>
                  <h3 className="text-slate-900 font-black text-xl mb-2">Vault Locked</h3>
                  <p className="text-slate-500 text-sm max-w-md">The financial reporting vault is currently sealed. Please return on the 30th of the month to extract your official P&L statements.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-2xl">
              <h1 className="text-3xl font-black mb-8 tracking-tight">Store Settings & Compliance</h1>
              <div className="space-y-4">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 flex justify-between items-center opacity-60 grayscale cursor-not-allowed shadow-sm">
                  <div><h3 className="font-bold text-slate-900">LHDN e-Invoice API Key (Production)</h3><p className="text-xs text-slate-500 mt-1">Direct synchronization with Malaysian tax authorities.</p></div>
                  <button disabled className="bg-slate-200 text-slate-500 px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2">🔒 Locked by HQ</button>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-slate-200 flex justify-between items-center opacity-60 grayscale cursor-not-allowed shadow-sm">
                  <div><h3 className="font-bold text-slate-900">Custom Domain Configuration</h3><p className="text-xs text-slate-500 mt-1">Route your store to your own URL.</p></div>
                  <button disabled className="bg-slate-200 text-slate-500 px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2">🔒 Locked by HQ</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ==========================================
  // RENDER: 4. TIER 3 - POS TERMINAL (CASHIERS)
  // ==========================================
  if (activeRole === 'pos_terminal') {
    if (receiptData) {
      return (
        <div className="flex h-screen bg-slate-900 items-center justify-center p-6">
          <div className="bg-white p-8 max-w-md w-full rounded-2xl text-center font-mono text-sm shadow-2xl">
            <h2 className="font-black text-2xl mb-2">{tenant.business_name}</h2>
            <p className="text-slate-500 mb-6 border-b border-dashed border-slate-300 pb-6">Terminal Receipt #{receiptData.receiptNo}</p>
            <div className="space-y-3 mb-6">
              {receiptData.items.map(i => (
                <div key={i.id} className="flex justify-between">
                  <span>{i.qty}x {i.name}</span>
                  <span>RM {(i.price * i.qty).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-dashed border-slate-300 pt-4 space-y-2 mb-8 font-bold">
              <div className="flex justify-between"><span>Total (Inc. SST)</span><span className="text-lg">RM {receiptData.total.toFixed(2)}</span></div>
            </div>
            {receiptData.tin && <div className="bg-slate-100 p-3 rounded mb-6 text-xs text-slate-600">e-Invoice B2B Registered: {receiptData.tin}</div>}
            <button onClick={() => setReceiptData(null)} className="w-full bg-slate-900 text-white py-4 font-bold font-sans rounded-xl hover:bg-slate-800 transition">Begin New Transaction</button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex h-screen bg-slate-100 font-sans select-none">
        <div className="w-[70%] p-6 flex flex-col border-r border-slate-200">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-2xl font-black text-slate-900">Register Terminal</h1>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">{tenant.business_name} · Staff Mode</p>
            </div>
            <button onClick={handleLogout} className="text-xs font-bold text-red-500 hover:text-white border border-red-200 hover:bg-red-500 px-4 py-2 rounded-lg transition">Close Register</button>
          </div>
          
          <div className="grid grid-cols-4 gap-4 overflow-y-auto pr-2 pb-10">
            {products.length === 0 ? (
              <div className="col-span-4 text-center py-20 text-slate-400 font-medium">No products available. Add items in the Merchant Dashboard.</div>
            ) : (
              products.map(product => (
                <button key={product.id} onClick={() => addToCart(product)} className="bg-white rounded-2xl border border-slate-200 shadow-sm text-left active:scale-95 transition overflow-hidden flex flex-col h-44 group hover:border-blue-400 hover:shadow-md">
                  {product.image_url ? (
                    <div className="h-24 w-full bg-slate-100 overflow-hidden"><img src={product.image_url} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" /></div>
                  ) : (
                    <div className="h-24 w-full bg-slate-50 flex items-center justify-center text-xs font-bold text-slate-300 border-b border-slate-100">No Image</div>
                  )}
                  <div className="p-3 flex-1 flex flex-col justify-between">
                    <span className="font-bold text-sm leading-tight text-slate-800 line-clamp-2">{product.name}</span>
                    <span className="font-black text-blue-600 text-sm mt-1">RM {product.price.toFixed(2)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="w-[30%] bg-white flex flex-col shadow-2xl z-10">
          <div className="p-6 bg-slate-900 text-white flex justify-between items-center">
            <h2 className="font-black text-lg">Active Order</h2>
            <span className="bg-slate-700 text-xs px-2.5 py-1 rounded-full font-bold">{cart.reduce((t, i) => t + i.qty, 0)} Items</span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {cart.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm font-medium">Tap products to build order</div>
            ) : (
              cart.map(item => (
                <div key={item.id} className="flex flex-col bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex justify-between items-start mb-3">
                    <span className="font-bold text-sm text-slate-900 flex-1 pr-2 leading-tight">{item.name}</span>
                    <span className="font-black text-sm text-blue-600">RM {(item.price * item.qty).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => updateQty(item.id, -1)} className="w-8 h-8 rounded bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition">-</button>
                    <span className="font-black text-sm w-4 text-center">{item.qty}</span>
                    <button onClick={() => updateQty(item.id, 1)} className="w-8 h-8 rounded bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition">+</button>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="p-6 bg-white border-t border-slate-200 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.1)]">
            <div className="bg-blue-50 border border-blue-100 p-3 rounded-xl mb-4">
              <label className="flex items-center justify-between text-xs font-bold text-blue-900 cursor-pointer">
                <span>Enable B2B e-Invoice (LHDN)</span>
                <input type="checkbox" checked={showLhdn} onChange={(e) => setShowLhdn(e.target.checked)} className="w-4 h-4 rounded" />
              </label>
              {showLhdn && <input type="text" placeholder="Scan or Enter Buyer TIN" value={tin} onChange={(e) => setTin(e.target.value)} className="mt-3 w-full text-xs p-2.5 rounded border border-blue-200 outline-none" />}
            </div>
            
            <div className="space-y-1.5 mb-4 text-sm font-medium text-slate-500">
              <div className="flex justify-between"><span>Subtotal</span><span>RM {cart.reduce((s, i) => s + (i.price * i.qty), 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span>SST (6%)</span><span>RM {(cart.reduce((s, i) => s + (i.price * i.qty), 0) * 0.06).toFixed(2)}</span></div>
              <div className="flex justify-between text-xl font-black text-slate-900 pt-3 border-t border-slate-100 mt-2">
                <span>Total Due</span>
                <span>RM {(cart.reduce((s, i) => s + (i.price * i.qty), 0) * 1.06).toFixed(2)}</span>
              </div>
            </div>
            
            <button disabled={cart.length === 0 || isProcessing} onClick={handleCheckout} className="w-full bg-blue-600 text-white font-black py-4 rounded-xl text-lg hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 transition">
              {isProcessing ? 'Transmitting to LHDN...' : `Charge RM ${(cart.reduce((s, i) => s + (i.price * i.qty), 0) * 1.06).toFixed(2)}`}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null // Fallback
}