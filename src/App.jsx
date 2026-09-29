import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export default function App() {
  const [view, setView] = useState('pos') // 'pos', 'receipt', 'admin', 'kds'
  const [cart, setCart] = useState([])
  const [products, setProducts] = useState([])
  const [showLhdn, setShowLhdn] = useState(false)
  const [tin, setTin] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [receiptData, setReceiptData] = useState(null)
  
  // Admin & KDS State
  const [newProduct, setNewProduct] = useState({ name: '', price: '', category: 'Beverages' })
  const [kitchenOrders, setKitchenOrders] = useState([])

  const tenantId = '11111111-1111-1111-1111-111111111111' 

  useEffect(() => {
    fetchProducts()
  }, [])

  // Fetch kitchen orders automatically when the KDS view is open
  useEffect(() => {
    let interval;
    if (view === 'kds') {
      fetchKitchenOrders()
      interval = setInterval(fetchKitchenOrders, 5000) // Auto-refresh every 5 seconds
    }
    return () => clearInterval(interval)
  }, [view])

  const fetchProducts = async () => {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
    
    if (error) console.error("Error fetching products:", error)
    else setProducts(data)
  }

  const fetchKitchenOrders = async () => {
    const { data, error } = await supabase
      .from('kitchen_orders')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      
    if (error) console.error("Error fetching KDS:", error)
    else setKitchenOrders(data)
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
    setIsProcessing(true)
    
    // 1. Save the financial sale
    const { data: salesData, error: salesError } = await supabase
      .from('sales')
      .insert([{
        tenant_id: tenantId,
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

    // 2. Send the ticket to the Kitchen Display
    await supabase
      .from('kitchen_orders')
      .insert([{
        tenant_id: tenantId,
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
    setIsProcessing(true)
    const { error } = await supabase.from('products').insert([{
      tenant_id: tenantId,
      name: newProduct.name,
      price: parseFloat(newProduct.price),
      category: newProduct.category
    }])
    setIsProcessing(false)
    
    if (error) alert("Error adding product: " + error.message)
    else {
      setNewProduct({ name: '', price: '', category: 'Beverages' })
      fetchProducts()
    }
  }

  const handleDeleteProduct = async (id) => {
    if (window.confirm("Are you sure you want to delete this item?")) {
      await supabase.from('products').delete().eq('id', id)
      fetchProducts()
    }
  }

  const handleCompleteOrder = async (orderId) => {
    await supabase
      .from('kitchen_orders')
      .update({ status: 'completed' })
      .eq('id', orderId)
    
    fetchKitchenOrders()
  }

  // --- VIEW: KITCHEN DISPLAY (KDS) ---
  if (view === 'kds') {
    return (
      <div className="min-h-screen bg-slate-900 p-6 font-sans text-white">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-black">Kitchen Display</h1>
          <div className="flex gap-4">
            <button onClick={fetchKitchenOrders} className="bg-slate-700 px-6 py-3 rounded-xl font-bold hover:bg-slate-600 transition">Refresh</button>
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

  // --- VIEW: ADMIN DASHBOARD ---
  if (view === 'admin') {
    return (
      <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-800">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-black text-slate-900">Manager Back-Office</h1>
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

  // --- VIEW: RECEIPT ---
  if (view === 'receipt' && receiptData) {
    return (
      <div className="flex h-screen bg-slate-800 items-center justify-center p-6">
        <div className="bg-white w-full max-w-sm p-8 shadow-2xl rounded-sm flex flex-col font-mono text-sm text-slate-800 relative">
          <div className="text-center mb-6 border-b border-dashed border-slate-300 pb-6">
            <h2 className="text-2xl font-black mb-1">HarminPOS</h2>
            <p className="text-xs text-slate-500">Bayan Lepas Branch</p>
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

  // --- VIEW: NORMAL POS ---
  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-800 antialiased">
      <div className="w-[70%] p-6 flex flex-col border-r border-slate-200">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">HarminPOS</h1>
            <p className="text-xs text-slate-500 font-medium">Terminal #01 · Bayan Lepas Branch</p>
          </div>
          <div className="flex gap-3 w-[60%]">
            <input type="text" placeholder="Search..." className="flex-1 px-4 py-2.5 bg-white rounded-xl border border-slate-200 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
            <button onClick={() => setView('kds')} className="bg-yellow-400 text-yellow-900 px-4 py-2.5 rounded-xl font-bold text-sm shadow-sm hover:bg-yellow-500 whitespace-nowrap">Kitchen Display</button>
            <button onClick={() => setView('admin')} className="bg-slate-200 px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-300 whitespace-nowrap">Manager Mode</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 overflow-y-auto pr-1">
          {products.length === 0 ? <div className="col-span-3 text-slate-500 text-sm py-10">Loading menu...</div> : 
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