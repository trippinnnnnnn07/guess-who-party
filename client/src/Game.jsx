import { useEffect, useState } from 'react'
import { Check, Clock3, EyeOff, Hand, RotateCcw, Trophy, X } from 'lucide-react'

function Countdown({ round, receivedAt, connected }) {
  const [remaining, setRemaining] = useState(round.remainingMs)
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, round.remainingMs - (
      round.phase === 'turn' ? performance.now() - receivedAt : 0
    )))
    update()
    if (round.phase !== 'turn') return
    const interval = window.setInterval(update, 100)
    return () => window.clearInterval(interval)
  }, [round.phase, round.remainingMs, round.turnId, receivedAt])

  const seconds = Math.ceil(remaining / 1000)
  const paused = round.phase === 'voting'
  return (
    <div className={`turn-clock ${seconds <= 5 && !paused ? 'turn-clock--urgent' : ''}`}>
      <div className="turn-clock__value">
        <Clock3 size={22} />
        <strong role="timer" aria-label={`เหลือ ${seconds} วินาที`}>{seconds.toString().padStart(2, '0')}</strong>
        <span>วินาที</span>
        <small>{!connected ? 'กำลังเชื่อมต่อใหม่' : paused ? 'หยุดเวลารอโหวต' : seconds === 0 ? 'กำลังเปลี่ยนตา…' : 'ครบเวลาแล้วเปลี่ยนตา'}</small>
      </div>
      <div className="turn-clock__track"><div style={{ width: `${Math.min(100, remaining / round.durationMs * 100)}%` }} /></div>
    </div>
  )
}

function CharacterCard({ player, featured = false, winner = false }) {
  // The server sends the winner their answer only after a unanimous correct vote.
  const hidden = !player.assignedCharacter
  return (
    <article className={`character-card ${featured ? 'character-card--stage' : ''} ${hidden ? 'character-card--hidden' : ''}`}>
      <div className="character-card__owner">
        <span>{player.name}{player.isMe ? ' (คุณ)' : ''}</span>
        {winner ? <span className="winner-badge"><Trophy size={16} /> ผู้ชนะ</span> : !player.connected ? <small>ออฟไลน์</small> : null}
      </div>
      <div className="character-card__image">
        {hidden ? (
          <div className="mystery-face"><EyeOff size={32} /><strong>?</strong><span>เพื่อนเห็นคำตอบของคุณอยู่</span></div>
        ) : (
          <img src={player.assignedCharacter.imageDataUrl} alt={player.assignedCharacter.name} />
        )}
      </div>
      <div className="character-card__answer">
        <strong>{hidden ? '???' : player.assignedCharacter.name}</strong>
        <span>{hidden ? 'ถามเพื่อน แล้วเดาว่าคุณเป็นใคร' : `ตัวละครบนหัวของ ${player.name}`}</span>
      </div>
    </article>
  )
}

function VotePanel({ room, onVote, busy, connected }) {
  const ballot = room.round.vote
  const me = room.players.find((player) => player.isMe)
  const candidate = room.players.find((player) => player.id === ballot.candidateId)
  const voters = room.players.filter((player) => ballot.eligibleIds.includes(player.id))
  const canVote = ballot.eligibleIds.includes(me.id) && ballot.myVote === null

  return (
    <section className="panel vote-panel" aria-label="โหวตคำตอบ">
      <span className="section-kicker">โหวตครั้งที่ {ballot.attempt}</span>
      <h2>{candidate.isMe ? 'บอกคำตอบของคุณกับเพื่อน' : `${candidate.name} ทายถูกไหม?`}</h2>
      <p className="helper-copy">ฟังคำตอบผ่านช่องทางที่คุยกัน แล้วให้ทุกคนยืนยันตรงกัน เวลาจะหยุดระหว่างโหวต</p>
      {candidate.isMe ? (
        <div className="vote-wait">รอเพื่อนทุกคนตัดสินคำตอบของคุณ</div>
      ) : (
        <>
          <div className="vote-buttons">
            <button className={`vote-button vote-button--correct ${ballot.myVote === true ? 'is-selected' : ''}`} disabled={!canVote || busy || !connected} onClick={() => onVote(ballot.id, true)}>
              <Check size={23} /> ทายถูก
            </button>
            <button className={`vote-button vote-button--wrong ${ballot.myVote === false ? 'is-selected' : ''}`} disabled={!canVote || busy || !connected} onClick={() => onVote(ballot.id, false)}>
              <X size={23} /> ทายผิด
            </button>
          </div>
          {ballot.myVote !== null && <p className="vote-wait">คุณเลือก “{ballot.myVote ? 'ทายถูก' : 'ทายผิด'}” แล้ว รอเพื่อนที่เหลือ</p>}
        </>
      )}
      <div className="vote-progress" aria-live="polite">โหวตแล้ว <b>{ballot.votedIds.length}/{voters.length}</b> คน</div>
      <ul className="vote-voters">
        {voters.map((player) => (
          <li key={player.id}>
            <span>{player.name}{player.isMe ? ' (คุณ)' : ''}</span>
            <small>{ballot.votedIds.includes(player.id) ? '✓ เลือกแล้ว' : player.connected ? 'รอเลือก' : 'รอเชื่อมต่อใหม่'}</small>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Game({ room, connected, onReset, onAnswer, onVote, busy, topbar }) {
  const round = room.round
  const me = room.players.find((player) => player.isMe)
  const winner = round.winner
  const current = winner
    ? { ...winner, isMe: winner.id === me.id, connected: true }
    : room.players.find((player) => player.id === round.activePlayerId)
  const queue = round.order.map((id) => room.players.find((player) => player.id === id)).filter(Boolean)
  const myTurn = current?.isMe && round.phase === 'turn'

  return (
    <div className="room-page game-page">
      {topbar}
      <main className="game page-shell">
        <section className="game__heading">
          <div>
            <span className="eyebrow">{winner ? 'จบรอบแล้ว' : `ตาที่ ${round.turnNumber}`} · V0.2</span>
            <h1>{winner ? `${winner.name} ชนะแล้ว!` : current?.isMe ? 'ถึงตาคุณแล้ว!' : `ตาของ ${current?.name}`}</h1>
            <p>{winner ? 'ทุกคนยืนยันตรงกันว่าทายถูก เปิดเผยตัวละครของผู้ชนะแล้ว' : 'ถามเพื่อนผ่านช่องทางที่คุยกันอยู่ คุณมีเวลา 15 วินาที ถ้ารู้แล้วกดตอบได้เลย'}</p>
          </div>
          {me?.isHost && <button className="ghost-button" type="button" onClick={onReset} disabled={busy || !connected}><RotateCcw size={18} /> เริ่มรอบใหม่</button>}
        </section>

        {!winner && (
          <nav className="turn-queue" aria-label="ลำดับผู้เล่น">
            <span className="turn-queue__label">คิวผู้เล่น</span>
            <ol>
              {queue.map((player, index) => (
                <li key={player.id} className={player.id === round.activePlayerId ? 'is-active' : ''} aria-current={player.id === round.activePlayerId ? 'step' : undefined}>
                  <b>{index + 1}</b><span>{player.name}{player.isMe ? ' (คุณ)' : ''}{!player.connected ? ' · ออฟไลน์' : ''}</span>
                </li>
              ))}
            </ol>
          </nav>
        )}

        {round.notice && <div className={`round-notice round-notice--${round.notice.type}`} role="status">{round.notice.message}</div>}
        {!connected && <div className="round-notice" role="status">การเชื่อมต่อขาดหาย กำลังกลับเข้าห้องเดิม…</div>}

        <div className="turn-stage">
          {current && <CharacterCard player={current} featured winner={Boolean(winner)} />}
          <aside className="turn-controls">
            {winner ? (
              <section className="panel winner-panel" role="status">
                <Trophy size={54} />
                <h2>{winner.id === me.id ? 'คุณทายถูกแล้ว!' : `ยินดีกับ ${winner.name}`}</h2>
                <p>คำตอบคือ <b>{winner.assignedCharacter.name}</b></p>
                <p className="helper-copy">{me.isHost ? 'กดเริ่มรอบใหม่เพื่อเลือกตัวละครและเล่นอีกครั้ง' : 'รอโฮสต์เริ่มรอบใหม่เพื่อเล่นต่อ'}</p>
              </section>
            ) : (
              <>
                <Countdown round={round} receivedAt={room.receivedAt} connected={connected} />
                {round.phase === 'voting' ? <VotePanel room={room} onVote={onVote} busy={busy} connected={connected} /> : (
                  <section className="panel answer-panel">
                    <span className="section-kicker">{myTurn ? 'พร้อมตอบแล้วหรือยัง?' : 'ฟังคำถามของเพื่อน'}</span>
                    <h2>{myTurn ? 'รู้แล้วว่าฉันเป็นใคร!' : `รอ ${current?.name} กดตอบ`}</h2>
                    <p className="helper-copy">{myTurn ? 'กดปุ่มเพื่อหยุดเวลา แล้วพูดคำตอบให้เพื่อนฟัง ทุกคนจะช่วยกันโหวต' : 'ช่วยตอบคำถามระหว่างตา เมื่อเพื่อนกดตอบ คุณจะได้โหวตว่าถูกหรือผิด'}</p>
                    <button className="primary-button answer-button" onClick={() => onAnswer(round.turnId)} disabled={!myTurn || busy || !connected}>
                      <Hand size={21} /> {myTurn ? 'กดตอบ' : 'ยังไม่ถึงตาของคุณ'}
                    </button>
                    <p className="answer-panel__rule">ถูกทุกเสียง = ชนะ · ผิดทุกเสียง = เล่นต่อ<br />เสียงไม่ตรงกัน = โหวตใหม่</p>
                  </section>
                )}
              </>
            )}
          </aside>
        </div>

        <section className="friends-section">
          <div className="section-label"><span>ตัวละครของทุกคน</span><i /></div>
          <div className="game-grid">
            {room.players.map((player) => <CharacterCard key={player.id} player={player} winner={player.id === winner?.id} />)}
          </div>
        </section>
      </main>
    </div>
  )
}
