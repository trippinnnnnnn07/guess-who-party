import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import {
  Check,
  Copy,
  Crown,
  EyeOff,
  Image as ImageIcon,
  LoaderCircle,
  LogIn,
  LogOut,
  PartyPopper,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  UploadCloud,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'

const STORAGE_KEY = 'guess-who-party-session-v1'
const socket = io(import.meta.env.VITE_SERVER_URL || undefined, {
  autoConnect: true,
  reconnection: true,
})

function readSavedSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

function saveSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY)
}

function emitWithAck(event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(8_000).emit(event, payload, (error, response) => {
      if (error) {
        resolve({ ok: false, error: 'เซิร์ฟเวอร์ไม่ตอบสนอง กรุณาลองอีกครั้ง' })
      } else {
        resolve(response)
      }
    })
  })
}

function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <div className="brand__mark" aria-hidden="true">
        ?
      </div>
      <div>
        <strong>หัวใคร ใครรู้?</strong>
        {!compact && <span>เกมทายตัวละครกับแก๊งเพื่อน</span>}
      </div>
    </div>
  )
}

function ConnectionBadge({ connected }) {
  return (
    <div className={`connection ${connected ? 'connection--online' : ''}`}>
      {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
      <span>{connected ? 'ออนไลน์' : 'กำลังเชื่อมต่อ'}</span>
    </div>
  )
}

function Toast({ message, onClose }) {
  if (!message) return null
  return (
    <div className="toast" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="ปิดข้อความ">
        <X size={18} />
      </button>
    </div>
  )
}

function Landing({ onEnter, busy, connected }) {
  const [mode, setMode] = useState('create')
  const [name, setName] = useState(localStorage.getItem('guess-who-party-name') || '')
  const [roomCode, setRoomCode] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return onEnter({ localError: 'บอกชื่อของคุณก่อนนะ' })
    if (mode === 'join' && roomCode.trim().length < 4) {
      return onEnter({ localError: 'ใส่รหัสห้องให้ครบก่อนนะ' })
    }
    localStorage.setItem('guess-who-party-name', trimmedName)
    await onEnter({ mode, name: trimmedName, roomCode })
  }

  return (
    <div className="landing page-shell">
      <header className="landing__nav">
        <Brand />
        <ConnectionBadge connected={connected} />
      </header>

      <main className="hero">
        <section className="hero__copy">
          <div className="eyebrow">
            <Sparkles size={16} /> คืนนี้ใครจะโดนทายก่อน?
          </div>
          <h1>
            ตัวละครอยู่บนหัว
            <br />
            <em>แต่คำตอบอยู่ที่เพื่อน</em>
          </h1>
          <p>
            สร้างห้อง ชวนเพื่อน แล้วส่งตัวละครลับคนละหนึ่งตัว
            ที่เหลือปล่อยให้เราสุ่มให้เอง
          </p>

          <div className="how-it-works" aria-label="วิธีเล่น">
            <div><b>01</b><span>รวมแก๊ง</span></div>
            <div><b>02</b><span>ส่งตัวละคร</span></div>
            <div><b>03</b><span>ถามให้เจอ</span></div>
          </div>
        </section>

        <section className="join-card">
          <div className="join-card__art" aria-hidden="true">
            <div className="mini-card mini-card--one">?</div>
            <div className="mini-card mini-card--two"><Sparkles /></div>
            <div className="mini-card mini-card--three">!</div>
          </div>

          <div className="mode-tabs" role="tablist" aria-label="เลือกวิธีเข้าเกม">
            <button
              type="button"
              className={mode === 'create' ? 'active' : ''}
              onClick={() => setMode('create')}
              role="tab"
              aria-selected={mode === 'create'}
            >
              <Plus size={18} /> สร้างห้อง
            </button>
            <button
              type="button"
              className={mode === 'join' ? 'active' : ''}
              onClick={() => setMode('join')}
              role="tab"
              aria-selected={mode === 'join'}
            >
              <LogIn size={18} /> เข้าร่วมห้อง
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <label htmlFor="player-name">ชื่อของคุณ</label>
            <input
              id="player-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="เช่น มายด์"
              maxLength={32}
              autoComplete="nickname"
              autoFocus
            />

            {mode === 'join' && (
              <>
                <label htmlFor="room-code">รหัสห้อง</label>
                <input
                  id="room-code"
                  className="code-input"
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/\s/g, ''))}
                  placeholder="ABC123"
                  maxLength={6}
                  autoComplete="off"
                />
              </>
            )}

            <button className="primary-button" type="submit" disabled={busy || !connected}>
              {busy ? <LoaderCircle className="spin" size={20} /> : mode === 'create' ? <Plus size={20} /> : <LogIn size={20} />}
              {busy ? 'กำลังเตรียมห้อง...' : mode === 'create' ? 'สร้างห้องใหม่' : 'ไปที่ห้องนี้'}
            </button>
          </form>

          <p className="join-card__note">ไม่ต้องสมัครสมาชิก • เล่นได้ทันที</p>
        </section>
      </main>

      <footer className="landing__footer">
        <span>คุยกันผ่าน Discord, LINE หรือช่องทางที่ถนัดได้เลย</span>
        <span className="landing__footer-dot">●</span>
        <span>เราเก็บห้องไว้ชั่วคราวระหว่างเล่นเท่านั้น</span>
      </footer>
    </div>
  )
}

function RoomTopbar({ room, connected, onLeave }) {
  const [copied, setCopied] = useState(false)

  async function copyCode() {
    await navigator.clipboard.writeText(room.code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  return (
    <header className="room-topbar page-shell">
      <Brand compact />
      <div className="room-topbar__actions">
        <ConnectionBadge connected={connected} />
        <button className="room-code" type="button" onClick={copyCode} title="คัดลอกรหัสห้อง">
          <span>รหัสห้อง</span>
          <b>{room.code}</b>
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
        <button className="icon-button" type="button" onClick={onLeave} title="ออกจากห้อง">
          <LogOut size={19} />
        </button>
      </div>
    </header>
  )
}

function PlayerList({ room }) {
  return (
    <section className="panel players-panel">
      <div className="section-heading">
        <div>
          <span className="section-kicker">ผู้เล่นในห้อง</span>
          <h2>แก๊งนี้มี {room.playerCount} คน</h2>
        </div>
        <div className="count-badge"><Users size={16} /> {room.playerCount}</div>
      </div>

      <div className="player-list">
        {room.players.map((player, index) => (
          <div className={`player-row ${!player.connected ? 'player-row--offline' : ''}`} key={player.id}>
            <div className={`avatar avatar--${(index % 4) + 1}`}>{player.name.charAt(0).toUpperCase()}</div>
            <div className="player-row__name">
              <strong>{player.name} {player.isMe && <span>(คุณ)</span>}</strong>
              <small>{player.connected ? 'พร้อมอยู่ในห้อง' : 'หลุดการเชื่อมต่อชั่วคราว'}</small>
            </div>
            {player.isHost && <Crown className="host-icon" size={19} aria-label="โฮสต์" />}
            <div className={`ready-dot ${player.isReady ? 'ready-dot--done' : ''}`}>
              {player.isReady ? <Check size={15} /> : <span />}
              {player.isReady ? 'ส่งแล้ว' : 'กำลังเลือก'}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function CharacterForm({ room, onSubmit, busy }) {
  const [characterName, setCharacterName] = useState(room.myCharacter?.name || '')
  const [imageDataUrl, setImageDataUrl] = useState(room.myCharacter?.imageDataUrl || '')
  const [fileError, setFileError] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (room.myCharacter) {
      setCharacterName(room.myCharacter.name)
      setImageDataUrl(room.myCharacter.imageDataUrl)
    }
  }, [room.myCharacter])

  function selectImage(file) {
    setFileError('')
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setFileError('รองรับเฉพาะ PNG, JPG, WEBP และ GIF')
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      setFileError('รูปต้องมีขนาดไม่เกิน 3 MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setImageDataUrl(String(reader.result))
    reader.onerror = () => setFileError('อ่านไฟล์นี้ไม่สำเร็จ ลองเลือกรูปอื่นนะ')
    reader.readAsDataURL(file)
  }

  function handleDrop(event) {
    event.preventDefault()
    selectImage(event.dataTransfer.files?.[0])
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!characterName.trim() || !imageDataUrl) {
      setFileError('ใส่ชื่อและเลือกรูปตัวละครให้ครบก่อนนะ')
      return
    }
    await onSubmit({ name: characterName.trim(), imageDataUrl })
  }

  return (
    <section className="panel character-panel">
      <div className="section-heading">
        <div>
          <span className="section-kicker">ภารกิจของคุณ</span>
          <h2>{room.myCharacter ? 'เปลี่ยนใจได้เสมอ' : 'ส่งตัวละครลับ'}</h2>
        </div>
        <Sparkles className="heading-sparkle" size={25} />
      </div>
      <p className="helper-copy">เลือกตัวละครที่เพื่อนน่าจะรู้จัก คนอื่นจะยังไม่เห็นจนกว่าเกมจะเริ่ม</p>

      <form onSubmit={handleSubmit}>
        <label htmlFor="character-name">ชื่อตัวละคร</label>
        <input
          id="character-name"
          value={characterName}
          onChange={(event) => setCharacterName(event.target.value)}
          maxLength={50}
          placeholder="เช่น โดราเอมอน"
        />

        <label>รูปตัวละคร</label>
        <button
          className={`upload-zone ${imageDataUrl ? 'upload-zone--filled' : ''}`}
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {imageDataUrl ? (
            <>
              <img src={imageDataUrl} alt="ตัวอย่างตัวละครที่เลือก" />
              <span className="upload-zone__change"><ImageIcon size={17} /> เปลี่ยนรูป</span>
            </>
          ) : (
            <>
              <span className="upload-icon"><UploadCloud size={27} /></span>
              <strong>คลิกหรือลากรูปมาวาง</strong>
              <small>PNG, JPG, WEBP หรือ GIF • ไม่เกิน 3 MB</small>
            </>
          )}
        </button>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => selectImage(event.target.files?.[0])}
        />
        {fileError && <p className="field-error">{fileError}</p>}

        <button className="secondary-button" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={19} /> : <Check size={19} />}
          {room.myCharacter ? 'อัปเดตตัวละคร' : 'ยืนยันตัวละครนี้'}
        </button>
      </form>
    </section>
  )
}

function Lobby({ room, connected, onLeave, onSubmitCharacter, onStart, busy }) {
  const me = room.players.find((player) => player.isMe)
  const canStart = room.playerCount >= 2 && room.allReady && room.allConnected

  return (
    <div className="room-page">
      <RoomTopbar room={room} connected={connected} onLeave={onLeave} />
      <main className="lobby page-shell">
        <div className="lobby__intro">
          <div>
            <span className="eyebrow"><PartyPopper size={16} /> ห้องพร้อมแล้ว</span>
            <h1>ชวนเพื่อนเข้ามา แล้วเลือกตัวละครได้เลย</h1>
          </div>
          <p>แชร์รหัส <b>{room.code}</b> ให้เพื่อน ทุกอย่างในหน้านี้จะอัปเดตแบบเรียลไทม์</p>
        </div>

        <div className="lobby__grid">
          <PlayerList room={room} />
          <CharacterForm room={room} onSubmit={onSubmitCharacter} busy={busy} />
        </div>

        <section className="start-bar">
          <div>
            <strong>{canStart ? 'ทุกคนพร้อมแล้ว!' : 'กำลังรอความพร้อม...'}</strong>
            <span>
              {room.playerCount < 2
                ? 'ต้องมีผู้เล่นอย่างน้อย 2 คน'
                : !room.allConnected
                  ? 'มีเพื่อนหลุดการเชื่อมต่อชั่วคราว'
                  : !room.allReady
                    ? `${room.players.filter((player) => player.isReady).length}/${room.playerCount} คนส่งตัวละครแล้ว`
                    : 'ได้เวลาสุ่มตัวละครขึ้นหัว'}
            </span>
          </div>
          {me?.isHost ? (
            <button className="primary-button start-button" type="button" disabled={!canStart || busy} onClick={onStart}>
              {busy ? <LoaderCircle className="spin" size={20} /> : <Play size={20} fill="currentColor" />}
              เริ่มเกม
            </button>
          ) : (
            <span className="waiting-host"><Crown size={18} /> รอโฮสต์เริ่มเกม</span>
          )}
        </section>
      </main>
    </div>
  )
}

function CharacterCard({ player, featured = false }) {
  const hidden = player.isMe
  return (
    <article className={`game-card ${featured ? 'game-card--featured' : ''} ${hidden ? 'game-card--hidden' : ''}`}>
      <div className="game-card__label">
        <span>{player.name}</span>
        {player.isMe && <b>คุณ</b>}
      </div>
      <div className="game-card__image">
        {hidden ? (
          <div className="mystery-face">
            <EyeOff size={28} />
            <strong>?</strong>
          </div>
        ) : (
          <img src={player.assignedCharacter?.imageDataUrl} alt={player.assignedCharacter?.name || ''} />
        )}
      </div>
      <div className="game-card__answer">
        {hidden ? (
          <>
            <strong>???</strong>
            <span>ห้ามแอบดูนะ!</span>
          </>
        ) : (
          <>
            <strong>{player.assignedCharacter?.name}</strong>
            <span>ตัวละครบนหัวของ {player.name}</span>
          </>
        )}
      </div>
    </article>
  )
}

function Game({ room, connected, onLeave, onReset, busy }) {
  const me = room.players.find((player) => player.isMe)
  const others = room.players.filter((player) => !player.isMe)

  return (
    <div className="room-page game-page">
      <RoomTopbar room={room} connected={connected} onLeave={onLeave} />
      <main className="game page-shell">
        <section className="game__heading">
          <div>
            <span className="eyebrow"><Sparkles size={16} /> เกมเริ่มแล้ว</span>
            <h1>มองทุกคนให้ดี... ยกเว้นตัวเอง</h1>
            <p>ผลัดกันถามคำถามกับเพื่อนผ่านช่องทางที่คุยกันอยู่ แล้วเดาให้ถูกว่าคุณคือใคร</p>
          </div>
          {me?.isHost && (
            <button className="ghost-button" type="button" onClick={onReset} disabled={busy}>
              <RotateCcw size={18} /> เริ่มรอบใหม่
            </button>
          )}
        </section>

        <section className="your-card-section">
          <div className="section-label"><span>บนหัวของคุณ</span><i /></div>
          <CharacterCard player={me} featured />
        </section>

        <section className="friends-section">
          <div className="section-label"><span>ตัวละครของเพื่อน</span><i /></div>
          <div className="game-grid">
            {others.map((player) => <CharacterCard key={player.id} player={player} />)}
          </div>
        </section>

        <div className="game-tip">
          <b>ทริกเล็ก ๆ</b>
          <span>เริ่มด้วยคำถามกว้าง ๆ เช่น “ฉันเป็นคนจริงไหม?” แล้วค่อยไล่ให้แคบลง</span>
        </div>
      </main>
    </div>
  )
}

function App() {
  const [room, setRoom] = useState(null)
  const [connected, setConnected] = useState(socket.connected)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(Boolean(readSavedSession()))
  const [message, setMessage] = useState('')
  const sessionRef = useRef(readSavedSession())

  useEffect(() => {
    async function restore() {
      setConnected(true)
      const saved = sessionRef.current
      if (!saved) {
        setRestoring(false)
        return
      }
      const response = await emitWithAck('rejoinRoom', saved)
      if (response?.ok) {
        setRoom(response.state)
      } else {
        clearSession()
        sessionRef.current = null
        setRoom(null)
        if (response?.error) setMessage(response.error)
      }
      setRestoring(false)
    }

    function handleDisconnect() {
      setConnected(false)
    }

    function handleRoomState(state) {
      setRoom(state)
    }

    function handleSessionReplaced() {
      clearSession()
      sessionRef.current = null
      setRoom(null)
      setMessage('บัญชีผู้เล่นนี้ถูกเปิดในแท็บอื่นแล้ว')
    }

    socket.on('connect', restore)
    socket.on('disconnect', handleDisconnect)
    socket.on('roomState', handleRoomState)
    socket.on('sessionReplaced', handleSessionReplaced)
    if (socket.connected) restore()

    return () => {
      socket.off('connect', restore)
      socket.off('disconnect', handleDisconnect)
      socket.off('roomState', handleRoomState)
      socket.off('sessionReplaced', handleSessionReplaced)
    }
  }, [])

  const currentView = useMemo(() => {
    if (!room) return 'landing'
    return room.status === 'playing' ? 'game' : 'lobby'
  }, [room])

  async function enterRoom({ mode, name, roomCode, localError }) {
    if (localError) return setMessage(localError)
    setBusy(true)
    setMessage('')
    const event = mode === 'create' ? 'createRoom' : 'joinRoom'
    const response = await emitWithAck(event, { name, roomCode })
    if (response?.ok) {
      sessionRef.current = response.session
      saveSession(response.session)
      setRoom(response.state)
    } else {
      setMessage(response?.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่')
    }
    setBusy(false)
  }

  async function runRoomAction(event, payload = {}) {
    setBusy(true)
    setMessage('')
    const response = await emitWithAck(event, payload)
    if (response?.ok && response.state) setRoom(response.state)
    if (!response?.ok) setMessage(response?.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่')
    setBusy(false)
    return response
  }

  async function leaveRoom() {
    await emitWithAck('leaveRoom')
    clearSession()
    sessionRef.current = null
    setRoom(null)
  }

  if (restoring) {
    return (
      <div className="restore-screen">
        <div className="restore-screen__mark">?</div>
        <LoaderCircle className="spin" size={24} />
        <span>กำลังพากลับเข้าห้อง...</span>
      </div>
    )
  }

  return (
    <>
      {currentView === 'landing' && <Landing onEnter={enterRoom} busy={busy} connected={connected} />}
      {currentView === 'lobby' && (
        <Lobby
          room={room}
          connected={connected}
          onLeave={leaveRoom}
          onSubmitCharacter={(payload) => runRoomAction('submitCharacter', payload)}
          onStart={() => runRoomAction('startGame')}
          busy={busy}
        />
      )}
      {currentView === 'game' && (
        <Game
          room={room}
          connected={connected}
          onLeave={leaveRoom}
          onReset={() => runRoomAction('resetGame')}
          busy={busy}
        />
      )}
      <Toast message={message} onClose={() => setMessage('')} />
    </>
  )
}

export default App
