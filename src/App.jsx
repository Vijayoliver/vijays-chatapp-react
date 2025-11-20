import React, { useEffect, useState } from 'react'
import { initializeApp } from 'firebase/app'
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth'
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  query,
  where,
  getDocs,
  addDoc,
  orderBy,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore'
import { getStorage, ref as stRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { firebaseConfig } from './firebase'

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)
const storage = getStorage(app)

function makeEmailFromUsername(username){
  return `${username.toLowerCase()}@vj-chat.local`
}

export default function App(){
  const [user, setUser] = useState(null)
  const [initializing, setInitializing] = useState(true)

  useEffect(()=>{
    return onAuthStateChanged(auth, async (u)=>{
      if(u){
        const userDoc = await getDoc(doc(db, 'users', u.uid))
        setUser({ uid: u.uid, email: u.email, ...(userDoc.exists()?userDoc.data():{}) })
      } else setUser(null)
      setInitializing(false)
    })
  },[])

  if(initializing) return <div className="center">Loading...</div>

  return (
    <div className="app-root">
      <header>
        <h1>Vijay's Chat App</h1>
        {user ? (
          <div className="user-bar">
            <span>{user.username}</span>
            <button onClick={()=>signOut(auth)}>Logout</button>
          </div>
        ) : null}
      </header>
      <main>
        {user ? <ChatShell user={user} /> : <Auth />}
      </main>
    </div>
  )
}

function Auth(){
  const [mode, setMode] = useState('login')
  return (
    <div className="auth-wrap">
      <div className="tabs">
        <button onClick={()=>setMode('login')} className={mode==='login'? 'active':''}>Login</button>
        <button onClick={()=>setMode('register')} className={mode==='register'? 'active':''}>Register</button>
      </div>
      {mode==='login' ? <LoginForm/> : <RegisterForm/>}
    </div>
  )
}

function RegisterForm(){
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function onRegister(e){
    e.preventDefault()
    setErr('')
    if(!username || !password){ setErr('Provide username and password'); return }
    setLoading(true)
    try{
      const q = query(collection(db, 'users'), where('username', '==', username.toLowerCase()))
      const snaps = await getDocs(q)
      if(!snaps.empty){ throw new Error('Username already taken') }

      const email = makeEmailFromUsername(username)
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      const uid = cred.user.uid
      await setDoc(doc(db, 'users', uid), { username: username.toLowerCase(), createdAt: serverTimestamp() })
    }catch(err){ setErr(err.message) }
    setLoading(false)
  }

  return (
    <form className="card" onSubmit={onRegister}>
      <h3>Create account</h3>
      <input placeholder="username" value={username} onChange={e=>setUsername(e.target.value)} />
      <input placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
      <button disabled={loading}>{loading? 'Creating...':'Create account'}</button>
      {err && <div className="err">{err}</div>}
      <p className="note">Note: You will login using username + password. No real email needed.</p>
    </form>
  )
}

function LoginForm(){
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function onLogin(e){
    e.preventDefault()
    setErr('')
    if(!username || !password){ setErr('Provide username and password'); return }
    setLoading(true)
    try{
      const email = makeEmailFromUsername(username)
      await signInWithEmailAndPassword(auth, email, password)
    }catch(err){ setErr('Invalid login') }
    setLoading(false)
  }

  return (
    <form className="card" onSubmit={onLogin}>
      <h3>Login</h3>
      <input placeholder="username" value={username} onChange={e=>setUsername(e.target.value)} />
      <input placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
      <button disabled={loading}>{loading? 'Logging...':'Login'}</button>
      {err && <div className="err">{err}</div>}
      <p className="note">Tip: create an account first if you don't have one.</p>
    </form>
  )
}

function ChatShell({user}){
  const [searchUser, setSearchUser] = useState('')
  const [peer, setPeer] = useState(null)

  return (
    <div className="chat-shell">
      <div className="left">
        <FindUser setPeer={setPeer} searchUser={searchUser} setSearchUser={setSearchUser} />
      </div>
      <div className="right">
        {peer ? <ChatWindow user={user} peer={peer} /> : <div className="empty">Select a user to chat with</div>}
      </div>
    </div>
  )
}

function FindUser({setPeer, searchUser, setSearchUser}){
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  async function onSearch(e){
    e.preventDefault()
    setLoading(true)
    const q = query(collection(db, 'users'), where('username', '==', searchUser.toLowerCase()))
    const snaps = await getDocs(q)
    const list = []
    snaps.forEach(s=> list.push({ id: s.id, ...s.data() }))
    setResults(list)
    setLoading(false)
  }

  return (
    <div>
      <form onSubmit={onSearch} className="search-form">
        <input placeholder="find username" value={searchUser} onChange={e=>setSearchUser(e.target.value)} />
        <button type="submit">Search</button>
      </form>
      {loading && <div>Searching...</div>}
      <div className="results">
        {results.map(r=> (
          <div key={r.id} className="result" onClick={()=>setPeer(r)}>
            {r.username}
          </div>
        ))}
      </div>
    </div>
  )
}

function getChatId(uid1, uid2){
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`
}

function ChatWindow({user, peer}){
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)

  const chatId = getChatId(user.uid, peer.id)

  useEffect(()=>{
    const msgsRef = collection(db, 'chats', chatId, 'messages')
    const q = query(msgsRef, orderBy('createdAt', 'asc'))
    const unsub = onSnapshot(q, snap=>{
      const arr = []
      snap.forEach(d=> arr.push({ id: d.id, ...d.data() }))
      setMessages(arr)
    })
    return unsub
  },[chatId])

  async function send(){
    if(!text && !file) return
    setLoading(true)
    try{
      let imageUrl = null
      if(file){
        const storageRef = stRef(storage, `chat_images/${chatId}/${Date.now()}_${file.name}`)
        await uploadBytes(storageRef, file)
        imageUrl = await getDownloadURL(storageRef)
      }
      const msgsRef = collection(db, 'chats', chatId, 'messages')
      await addDoc(msgsRef, { fromUid: user.uid, text: text||null, imageUrl: imageUrl||null, createdAt: serverTimestamp() })
      await setDoc(doc(db, 'chats', chatId), { participants: [user.uid, peer.id], lastUpdated: serverTimestamp() }, { merge: true })
      setText('')
      setFile(null)
    }catch(err){ console.error(err) }
    setLoading(false)
  }

  async function deleteMessage(msgId){
    const mDoc = doc(db, 'chats', chatId, 'messages', msgId)
    const snap = await getDoc(mDoc)
    if(!snap.exists()) return
    const data = snap.data()
    if(data.fromUid !== user.uid) return alert('Only owner can delete')
    await setDoc(mDoc, { deleted: true }, { merge: true })
  }

  return (
    <div className="chat-window">
      <div className="chat-header">Chat with {peer.username}</div>
      <div className="messages">
        {messages.map(m=> (
          <div key={m.id} className={`message ${m.fromUid===user.uid? 'me':'them'}`}>
            {m.deleted ? <i>message deleted</i> : (
              <>
                {m.text && <div className="text">{m.text}</div>}
                {m.imageUrl && <img src={m.imageUrl} alt="img" className="img" />}
                <div className="meta">{m.fromUid===user.uid? 'You':'Friend'}</div>
                {m.fromUid===user.uid && !m.deleted && <button className="del" onClick={()=>deleteMessage(m.id)}>Delete</button>}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="composer">
        <input value={text} onChange={e=>setText(e.target.value)} placeholder="Type a message" />
        <input type="file" accept="image/*" onChange={e=>setFile(e.target.files[0])} />
        <button onClick={send} disabled={loading}>{loading? 'Sending...':'Send'}</button>
      </div>
    </div>
  )
}
