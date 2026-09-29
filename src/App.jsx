import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export default function App() {
  const [session, setSession] = useState(null)
  const [tenant, setTenant] = useState(null)
  const [loadingTenant, setLoadingTenant] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  
  // Auth Form State
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)

  // App Views: 'pos', 'receipt', 'admin', 'kds', 'owner'
  const [view, setView] = useState('pos')
  const [cart, setCart] = useState([])
  const [products, setProducts] = useState([])
  const [showLhdn, setShowLhdn] = useState(false)
  const [tin, setTin] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [receiptData, setReceiptData] = useState(null)
  
  // Admin & KDS State
  const [newProduct, setNewProduct] = useState({ name: '', price: '', category: 'Beverages' })
  const [kitchenOrders, setKitchenOrders] = useState([])
  
  // Owner Platform State
  const [allTenants, setAllTenants] = useState([])
  const [platformSales, setPlatformSales] = useState([])

  const OWNER_EMAIL = 'harminsolutions96@gmail.com'

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        checkIfOwner(session.user.email)
        fetchTenantData(session.user.id, session.user.email)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        checkIfOwner(session.user.email)
        fetchTenantData(session.user.id, session.user.email)
      } else {
        setTenant(null)
        setProducts([])
        setIsOwner(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const checkIfOwner = (userEmail) => {
    setIsOwner(userEmail === OWNER_EMAIL)
  }

  const fetchTenantData = async (userId, userEmail) => {
    setLoadingTenant(true)
    
    if (userEmail === OWNER_EMAIL) {
      fetchPlatformOverview()
    }

    let { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    // FIXED: Changed 'name' to 'business_name' to match your database schema
    if (error || !data) {
      const { data: newTenant, error: createError } = await supabase
        .from('tenants')
        .insert([{ business_name: userEmail === OWNER_EMAIL ? 'Harmin Solutions HQ' : 'Merchant Branch', user_id: userId }])
        .select()
        .single()
      
      if (!createError) data = newTenant
    }

    setTenant(data)
    setLoadingTenant(false)
    if (data) fetchProducts(data.id)
  }

  const fetchPlatformOverview = async () => {
    const { data: tenantsData } = await supabase.from('tenants').select('*')
    const { data: salesData } = await supabase.from('sales').select('*')
    setAllTenants(tenantsData || [])
    setPlatformSales(salesData || [])
  }

  const fetchProducts = async (tenantId) => {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
    
    if (error) console.error("Error fetching products:", error)
    else setProducts(data || [])
  }

  useEffect(() => {
    let interval;
    if (view === 'kds' && tenant) {
      fetchKitchenOrders(tenant.id)
      interval = setInterval(() => fetchKitchenOrders(tenant.id), 5000)
    }
    return () => clearInterval(interval)
  }, [view, tenant])

  const fetchKitchenOrders = async (tenantId) => {
    const { data } = await supabase
      .from('kitchen_orders')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      
    setKitchenOrders(data || [])
  }

  const handleAuth = async (e) => {
    e.preventDefault()
    setIsProcessing(true)
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) alert(error.message)
      else alert("Check your email for confirmation or sign in.")
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) alert(error.message)
    }
    setIsProcessing(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setTenant(null)
    setIsOwner(false)
  }

  const addToCart = (product) => {
    const existing = cart.find(item => item.id === product.id)
    if (existing) {
      setCart(cart.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item))
    } else {
      setCart([...cart, { ...product, qty: 1 }])
    }
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

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0)
  const sst = subtotal * 0.06
  const total = subtotal + sst

  const handleCheckout = async () => {
    if (!tenant) return
    setIsProcessing(true)
    
    const { data: salesData, error: salesError } = await supabase
      .from('sales')
      .insert([{
        tenant_id: tenant.id,
        subtotal: subtotal,
        sst_amount: sst,
        total_amount: total,
        lhdn_buyer_tin: showLhdn ? tin : null
      }])
      .select()

    if (salesError) {
      setIsProcessing(false)
      alert("Checkout failed: " + salesError.message)
      return
    }

    const receiptNo = salesData[0].id.split('-')[0].toUpperCase()

    await supabase
      .from('kitchen_orders')
      .insert([{
        tenant_id: tenant.id,
        receipt_no: receiptNo,
        items: cart,
        status: 'pending'
      }])

    setIsProcessing(false)
    setReceiptData({
      items: [...cart],
      subtotal,
      sst,
      total,
      tin: showLhdn ? tin : null,
      date: new Date().toLocaleString(),
      receiptNo: receiptNo
    })
    setCart([])
    setTin('')
    setShowLhdn(false)
    setView('receipt')
  }

  const handleAddProduct = async (e) => {
    e.preventDefault()
    if (!tenant) return
    setIsProcessing(true)
    const { error } = await supabase.from('products').insert([{
      tenant_id: tenant.id,
      name: newProduct.name,
      price: parseFloat(newProduct.price),
      category: newProduct.category
    }])
    setIsProcessing(false)
    
    if (error) alert("Error adding product: " + error.message)
    else {
      setNewProduct({ name: '', price: '', category: 'Beverages' })
      fetchProducts(tenant.id)
    }
  }

  const handleDeleteProduct = async (id) => {
    if (window.confirm("Delete this item?")) {
      await supabase.from('products').delete().eq('id', id)
      fetchProducts(tenant.id)
    }
  }

  const handleCompleteOrder = async (orderId) => {
    await supabase.from('kitchen_orders').update({ status: 'completed' }).eq('id', orderId)
    fetchKitchenOrders(tenant.id)
  }

  // --- LUXURY LOGIN SCREEN ---
  if (!session) {
    return (
      <div className="flex h-screen bg-slate-950 font-sans text-slate-100 items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-900/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-900/20 rounded-full blur-3xl pointer-events-none"></div>

        <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-10 rounded-3xl shadow-2xl relative z-10">
          <div className="text-center mb-8">
            <div className="inline-block px-3 py-1 bg-slate-800 border border-slate-700 rounded-full text-xs font-semibold tracking-widest text-slate-400 uppercase mb-3">
              Enterprise POS
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white">HarminPOS</h1>
            <p className="text-sm text-slate-400 mt-1">Sign in to your merchant or owner portal</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-400 tracking-wider uppercase mb-2">Corporate Email</label>
              <input 
                required 
                type="email" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl focus:ring-2 focus:ring-slate-400 outline-none transition text-sm text-white placeholder-slate-600" 
                placeholder="name@company.com" 
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 tracking-wider uppercase mb-2">Password</label>
              <input 
                required 
                type="password" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl focus:ring-2 focus:ring-slate-400 outline-none transition text-sm text-white placeholder-slate-600" 
                placeholder="••••••••••••" 
              />
            </div>
            <button 
              disabled={isProcessing} 
              type="submit" 
              className="w-full bg-white text-slate-950 font-bold py-3.5 rounded-xl hover:bg-slate-200 active:scale-[0.99] transition shadow-lg text-sm tracking-wide mt-2"
            >
              {isProcessing ? 'Authenticating...' : (isSignUp ? 'Create Account' : 'Access Portal')}
            </button>
          </form>

          <div className="text-center mt-6 pt-6 border-t border-slate-800/80">
            <button 
              onClick={() => setIsSignUp(!isSignUp)} 
              className="text-xs text-slate-400 hover:text-white transition font-medium"
            >
              {isSignUp ? 'Already registered? Sign in here' : "Need a merchant account? Register workspace"}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loadingTenant || !tenant) {
    return (
      <div className="flex h-screen bg-slate-950 text-white items-center justify-center font-sans">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm font-medium tracking-wide text-slate-400">Loading secure session...</span>
        </div>
      </div>
    )
  }

  // --- VIEW: OWNER SUPER ADMIN DASHBOARD ---
  if (view === 'owner' && isOwner) {
    const totalPlatformRevenue = platformSales.reduce((sum, s) => sum + s.total_amount, 0)

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-8 font-sans">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-8 border-b border-slate-800 pb-6">
            <div>
              <span className="bg-blue-900/50 text-blue-400 border border-blue-700/50 text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider">Software Owner Console</span>
              <h1 className="text-3xl font-black tracking-tight text-white mt-2">HarminSolutions Global HQ</h1>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setView('pos')} className="bg-slate-800 hover:bg-slate-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition">
                Switch to POS Register
              </button>
              <button onClick={handleLogout} className="bg-red-600/20 text-red-400 border border-red-500/30 px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-red-600/30 transition">
                Sign Out
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6 mb-8">
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-lg">
              <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Active Tenants / Stores</p>
              <p className="text-4xl font-black text-white mt-2">{allTenants.length}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-lg">
              <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Total Platform Sales</p>
              <p className="text-4xl font-black text-white mt-2">{platformSales.length} orders</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-lg">
              <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Gross Platform Revenue</p>
              <p className="text-4xl font-black text-emerald-400 mt-2">RM {totalPlatformRevenue.toFixed(2)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg">
              <h2 className="text-xl font-bold mb-4 text-white">Registered Tenants</h2>
              <div className="space-y-3">
                {allTenants.map(t => (
                  <div key={t.id} className="flex justify-between items-center bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
                    <div>
                      <p className="font-bold text-white">{t.business_name || 'Unnamed Store'}</p>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">ID: {t.id}</p>
                    </div>
                    <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-full font-semibold">Active</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg">
              <h2 className="text-xl font-bold mb-4 text-white">Global Sales Audit Trail</h2>
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {platformSales.length === 0 ? (
                  <p className="text-slate-500 text-sm">No transactions recorded across the platform yet.</p>
                ) : (
                  platformSales.map(s => (
                    <div key={s.id} className="flex justify-between items-center bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 text-sm">
                      <div>
                        <p className="font-bold text-white">RM {s.total_amount.toFixed(2)}</p>
                        <p className="text-xs text-slate-400">Store ID: {s.tenant_id.slice(0, 8)}... · {new Date(s.created_at).toLocaleTimeString()}</p>
                      </div>
                      <span className="text-xs font-mono text-slate-500">{s.lhdn_buyer_tin ? 'B2B e-Invoice' : 'B2C Sale'}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // --- VIEW: KITCHEN DISPLAY (KDS) ---
  if (view === 'kds') {
    return (
      <div className="min-h-screen bg-slate-900 p-6 font-sans text-white">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-black">Kitchen Display</h1>
            <p className="text-xs text-slate-400">Store: {tenant.business_name}</p>
          </div>
          <div className="flex gap-4">
            <button onClick={() => fetchKitchenOrders(tenant.id)} className="bg-slate-700 px-6 py-3 rounded-xl font-bold hover:bg-slate-600 transition">Refresh</button>
            <button onClick={() => setView('pos')} className="bg-red-500 px-6 py-3 rounded-xl font-bold hover:bg-red-600 transition">Exit KDS</button>
          </div>
        </div>
        <div className="flex gap-6 overflow-x-auto pb-4">
          {kitchenOrders.length === 0 ? (
            <div className="text-slate-500 text-xl w-full text-center mt-20">No pending orders. Kitchen is clear!</div>
          ) : (
            kitchenOrders.map(order => (
              <div key={order.id} className="bg-white text-slate-900 min-w-[300px] w-[300px] flex flex-col rounded-2xl shadow-xl overflow-hidden shrink-0">
                <div className="bg-yellow-400 p-4 font-black flex justify-between items-center">
                  <span className="text-xl">#{order.receipt_no}</span>
                  <span className="text-sm font-bold bg-yellow-500 px-2 py-1 rounded">
                    {new Date(order.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </span>
                </div>
                <div className="p-4 flex-1 overflow-y-auto space-y-4 font-medium text-lg">
                  {order.items.map((item, i) => (
                    <div key={i} className="flex justify-between border-b border-slate-100 pb-2 last:border-0">
                      <span><span className="font-black mr-2">{item.qty}x</span> {item.name}</span>
                    </div>
                  ))}
                </div>
                <div className="p-4 bg-slate-50 border-t border-slate-200">
                  <button onClick={() => handleCompleteOrder(order.id)} className="w-full bg-green-500 text-white font-black py-4 rounded-xl hover:bg-green-600 active:scale-95 transition text-lg">
                    BUMP (READY)
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  // --- VIEW: ADMIN BACK-OFFICE ---
  if (view === 'admin') {
    return (
      <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-800">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-black text-slate-900">Manager Back-Office</h1>
              <p className="text-xs text-slate-500">Managing Inventory for: {tenant.business_name}</p>
            </div>
            <button onClick={() => setView('pos')} className="bg-slate-200 px-4 py-2 rounded-lg font-bold hover:bg-slate-300">
              Return to POS
            </button>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-8">
            <h2 className="text-xl font-bold mb-4">Add New Product</h2>
            <form onSubmit={handleAddProduct} className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="block text-sm font-bold text-slate-600 mb-1">Product Name</label>
                <input required type="text" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg" placeholder="e.g. Mocha Frappe" />
              </div>
              <div className="w-32">
                <label className="block text-sm font-bold text-slate-600 mb-1">Price (RM)</label>
                <input required type="number" step="0.01" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg" placeholder="12.50" />
              </div>
              <div className="w-48">
                <label className="block text-sm font-bold text-slate-600 mb-1">Category</label>
                <select value={newProduct.category} onChange={e => setNewProduct({...newProduct, category: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg bg-white">
                  <option>Beverages</option>
                  <option>Meals</option>
                  <option>Pastries</option>
                </select>
              </div>
              <button disabled={isProcessing} type="submit" className="bg-blue-600 text-white font-bold py-2.5 px-6 rounded-lg hover:bg-blue-700">
                {isProcessing ? 'Saving...' : 'Add Item'}
              </button>
            </form>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="p-4 font-bold text-slate-600">Product Name</th>
                  <th className="p-4 font-bold text-slate-600">Category</th>
                  <th className="p-4 font-bold text-slate-600">Price</th>
                  <th className="p-4 font-bold text-slate-600 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="p-4 font-medium">{p.name}</td>
                    <td className="p-4 text-slate-500">{p.category}</td>
                    <td className="p-4 font-bold">RM {p.price.toFixed(2)}</td>
                    <td className="p-4 text-right">
                      <button onClick={() => handleDeleteProduct(p.id)} className="text-red-500 hover:text-red-700 font-bold text-sm">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  // --- VIEW: RECEIPT SCREEN ---
  if (view === 'receipt' && receiptData) {
    return (
      <div className="flex h-screen bg-slate-800 items-center justify-center p-6">
        <div className="bg-white w-full max-w-sm p-8 shadow-2xl rounded-sm flex flex-col font-mono text-sm text-slate-800 relative">
          <div className="text-center mb-6 border-b border-dashed border-slate-300 pb-6">
            <h2 className="text-2xl font-black mb-1">HarminPOS</h2>
            <p className="text-xs text-slate-500">{tenant.business_name}</p>
            <p className="text-xs text-slate-500 mt-2">Date: {receiptData.date}</p>
            <p className="text-xs text-slate-500">Receipt #: {receiptData.receiptNo}</p>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 mb-6">
            {receiptData.items.map((item, index) => (
              <div key={index} className="flex justify-between">
                <div>
                  <p>{item.name}</p>
                  <p className="text-xs text-slate-500">{item.qty} x RM {item.price.toFixed(2)}</p>
                </div>
                <p>RM {(item.price * item.qty).toFixed(2)}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-dashed border-slate-300 pt-4 space-y-2 mb-6">
            <div className="flex justify-between text-slate-600"><span>Subtotal</span><span>RM {receiptData.subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between text-slate-600"><span>SST (6%)</span><span>RM {receiptData.sst.toFixed(2)}</span></div>
            <div className="flex justify-between text-lg font-bold pt-2"><span>Total</span><span>RM {receiptData.total.toFixed(2)}</span></div>
          </div>
          {receiptData.tin && (
            <div className="bg-slate-100 p-3 rounded text-center mb-6 text-xs border border-slate-200">
              <p className="font-bold">LHDN e-Invoice Requested</p>
              <p>Buyer TIN: {receiptData.tin}</p>
            </div>
          )}
          <button onClick={() => setView('pos')} className="w-full bg-slate-900 text-white font-bold py-3 rounded hover:bg-slate-800 transition font-sans">New Sale</button>
        </div>
      </div>
    )
  }

  // --- VIEW: MAIN POS REGISTER ---
  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-800 antialiased">
      <div className="w-[70%] p-6 flex flex-col border-r border-slate-200">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">HarminPOS</h1>
            <p className="text-xs text-slate-500 font-medium">Store: {tenant.business_name} · <button onClick={handleLogout} className="text-blue-600 hover:underline">Sign Out</button></p>
          </div>
          <div className="flex gap-2">
            {isOwner && (
              <button onClick={() => setView('owner')} className="bg-blue-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-sm hover:bg-blue-700">
                Owner HQ Console
              </button>
            )}
            <button onClick={() => setView('kds')} className="bg-yellow-400 text-yellow-900 px-4 py-2.5 rounded-xl font-bold text-sm shadow-sm hover:bg-yellow-500">Kitchen Display</button>
            <button onClick={() => setView('admin')} className="bg-slate-200 px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-300">Manager Mode</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 overflow-y-auto pr-1">
          {products.length === 0 ? <div className="col-span-3 text-slate-500 text-sm py-10">No products found. Go to Manager Mode to add inventory!</div> : 
            products.map(product => (
              <button key={product.id} onClick={() => addToCart(product)} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-left hover:border-slate-400 hover:shadow transition active:scale-95 flex flex-col justify-between h-32">
                <span className="font-semibold text-slate-900">{product.name}</span>
                <span className="text-base font-bold text-slate-900">RM {product.price.toFixed(2)}</span>
              </button>
            ))
          }
        </div>
      </div>

      <div className="w-[30%] bg-white flex flex-col shadow-xl">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-900">Current Order</h2>
          <span className="text-xs bg-slate-100 px-2.5 py-1 rounded-full font-semibold text-slate-600">{cart.reduce((t, i) => t + i.qty, 0)} items</span>
        </div>

        <div className="flex-1 p-6 overflow-y-auto space-y-3">
          {cart.length === 0 ? <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm">Tap items to add to order</div> : 
            cart.map(item => (
              <div key={item.id} className="flex justify-between items-center bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <div className="flex-1 pr-2">
                  <p className="font-semibold text-sm text-slate-900">{item.name}</p>
                  <p className="text-xs text-slate-500">RM {item.price.toFixed(2)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => updateQty(item.id, -1)} className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-700 font-bold text-sm">-</button>
                  <span className="text-sm font-bold w-4 text-center">{item.qty}</span>
                  <button onClick={() => updateQty(item.id, 1)} className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-700 font-bold text-sm">+</button>
                </div>
              </div>
            ))
          }
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 space-y-4">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200">
            <label className="flex items-center justify-between text-xs font-bold text-slate-700 cursor-pointer">
              <span>LHDN e-Invoice (B2B)</span>
              <input type="checkbox" checked={showLhdn} onChange={(e) => setShowLhdn(e.target.checked)} className="w-4 h-4 rounded accent-slate-900" />
            </label>
            {showLhdn && <input type="text" placeholder="Buyer Tax ID (TIN)" value={tin} onChange={(e) => setTin(e.target.value)} className="mt-2.5 w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-900" />}
          </div>

          <div className="space-y-1.5 text-xs text-slate-600 font-medium">
            <div className="flex justify-between"><span>Subtotal</span><span>RM {subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>SST (6%)</span><span>RM {sst.toFixed(2)}</span></div>
            <div className="flex justify-between text-base font-black text-slate-900 pt-2 border-t border-slate-200"><span>Total</span><span>RM {total.toFixed(2)}</span></div>
          </div>

          <button disabled={cart.length === 0 || isProcessing} onClick={handleCheckout} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 disabled:bg-slate-300 transition shadow-sm text-sm">
            {isProcessing ? 'Processing...' : `Charge RM ${total.toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  )
}