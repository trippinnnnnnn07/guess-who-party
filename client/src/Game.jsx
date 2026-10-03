import { useEffect, useState } from 'react'
import { Check, Clock3, EyeOff, Hand, RotateCcw, Trophy, X } from 'lucide-react'

function Countdown({ round, receivedAt, connected }) {
  const [remaining, setRemaining] = useState(round.remainingMs)
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, round.remainingMs - (
      round.deadlineAt !== null ? performance.now() - receivedAt : 0
    )))
    update()
    if (round.deadlineAt === null) return
    const interval = window.setInterval(update, 100)
    return () => window.clearInterval(interval)
  }, [round.phase, round.remainingMs, round.turnId, round.deadlineAt, receivedAt])

  const seconds = Math.ceil(remaining / 1000)
  const paused = round.phase === 'voting'
  return (
    <div className={`turn-clock ${seconds <= 5 && !paused ? 'turn-clock--urgent' : ''}`}>
      <div className="turn-clock__value">
        <Clock3 size={22} />
        <strong role="timer" aria-label={`เหลือ ${seconds} วินาที`}>{seconds.toString().padStart(2, '0')}</strong>
        <span>วินาที</span>
        <small>{!connected ? 'กำลังเชื่อมต่อใหม่' : paused ? 'หยุดเวลารอโหวต' : round.phase === 'intermission' ? 'เริ่มรอบถัดไปอัตโนมัติ' : seconds === 0 ? 'กำลังเปลี่ยนตา…' : 'ครบเวลาแล้วเปลี่ยนตา'}</small>
      </div>
      <div className="turn-clock__track"><div style={{ width: `${Math.min(100, remaining / round.durationMs * 100)}%` }} /></div>
    </div>
  )
}

function CharacterCard({ player, featured = false }) {
  // The server reveals your answer only after you finish, or after the round ends.
  const hidden = !player.assignedCharacter
  return (
    <article className={`character-card ${featured ? 'character-card--stage' : ''} ${hidden ? 'character-card--hidden' : ''}`}>
      <div className="character-card__owner">
        <span>{player.name}{player.isMe ? ' (คุณ)' : ''}</span>
        {player.roundResult ? <span className="winner-badge">+{player.roundResult.points} แต้ม</span> : !player.connected ? <small>ออฟไลน์</small> : null}
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

function Scoreboard({ room, final = false }) {
  return (
    <section className="panel scoreboard" aria-label="ตารางคะแนนสะสม">
      <div className="section-heading">
        <div><span className="section-kicker">{final ? 'FINAL SCORE' : 'LIVE SCORE'}</span><h2>{final ? 'สรุปคะแนนทั้งหมด' : 'คะแนนสะสม'}</h2></div>
        <Trophy size={27} className="heading-sparkle" />
      </div>
      <div className="scoreboard-scroll" tabIndex={0} role="region" aria-label="คะแนนรายรอบ เลื่อนแนวนอนได้">
        <table>
          <thead><tr><th scope="col">อันดับ / ผู้เล่น</th>{Array.from({ length: room.totalRounds }, (_, i) => <th scope="col" key={i}>รอบ {i + 1}</th>)}<th scope="col">รวม</th></tr></thead>
          <tbody>
            {room.standings.map((entry) => {
              const rank = room.standings.findIndex((item) => item.total === entry.total) + 1
              return (
                <tr key={entry.id} className={final && room.winnerIds.includes(entry.id) ? 'scoreboard-winner' : ''}>
                  <th scope="row"><span className="score-rank">{rank}</span>{entry.name}{room.players.find((p) => p.id === entry.id)?.isMe ? ' (คุณ)' : ''}{entry.departed ? ' · ออกจากห้อง' : ''}{final && room.winnerIds.includes(entry.id) && <Trophy size={16} aria-label="ผู้ชนะ" />}</th>
                  {entry.rounds.map((points, i) => <td key={i}>{points ?? '—'}</td>)}
                  <td className="score-total">{entry.total}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="helper-copy">{final ? 'คะแนนเท่ากันเป็นอันดับร่วมกัน · ผู้ได้คะแนนรวมสูงสุดชนะ' : 'แต้มเพิ่มเมื่อทุกคนยืนยันว่าทายถูก · — หมายถึงยังไม่ได้สรุปคะแนนรอบนั้น'}</p>
    </section>
  )
}

export default function Game({ room, connected, onReset, onAnswer, onVote, busy, topbar }) {
  const [confirmReset, setConfirmReset] = useState(false)
  const round = room.round
  const me = room.players.find((player) => player.isMe)
  const final = room.status === 'finished'
  const intermission = round.phase === 'intermission'
  const playing = !final && !intermission
  const current = room.players.find((player) => player.id === round.activePlayerId)
  const queue = round.order.map((id) => room.players.find((player) => player.id === id)).filter(Boolean)
  const myTurn = current?.isMe && round.phase === 'turn'
  const winners = room.standings.filter((entry) => room.winnerIds.includes(entry.id))
  const winnerNames = winners.map((entry) => entry.name).join(' และ ')

  return (
    <div className="room-page game-page">
      {topbar}
      <main className="game page-shell">
        <section className="game__heading">
          <div>
            <span className="eyebrow">รอบที่ {round.number}/{room.totalRounds} · {final ? 'จบเกม' : intermission ? 'พักระหว่างรอบ' : `ตาที่ ${round.turnNumber}`} · V0.3</span>
            <h1>{final ? 'ได้ผู้ชนะแล้ว!' : intermission ? `จบรอบที่ ${round.number} แล้ว` : current?.isMe ? 'ถึงตาคุณแล้ว!' : `ตาของ ${current?.name}`}</h1>
            <p>{final ? 'ครบทุกรอบแล้ว มาดูคะแนนรวมของแก๊งนี้กัน' : intermission ? 'เปิดเผยตัวละครทุกคน พักดูคะแนนก่อนเริ่มรอบถัดไป' : me?.roundResult ? 'คุณทายถูกแล้ว ช่วยตอบคำถามและโหวตให้เพื่อนต่อได้เลย' : 'ถามเพื่อนผ่านช่องทางที่คุยกันอยู่ คุณมีเวลา 15 วินาที ถ้ารู้แล้วกดตอบได้เลย'}</p>
          </div>
          {me?.isHost && <div className="reset-actions">
            <button className="ghost-button" type="button" onClick={() => confirmReset ? onReset() : setConfirmReset(true)} disabled={busy || !connected}><RotateCcw size={18} />{confirmReset ? 'ยืนยันล้างคะแนนและเริ่มใหม่' : 'เริ่มเกมใหม่'}</button>
            {confirmReset && <button className="ghost-button" onClick={() => setConfirmReset(false)}>ยกเลิก</button>}
          </div>}
        </section>

        {!connected && <div className="round-notice" role="status">การเชื่อมต่อขาดหาย กำลังกลับเข้าห้องเดิม…</div>}
        {round.notice && <div className={`round-notice round-notice--${round.notice.type}`} role="status">{round.notice.message}</div>}

        {final && <section className="panel match-celebration" role="status">
          <Trophy size={50} /><span className="section-kicker">{winners.length > 1 ? 'ผู้ชนะร่วมกัน' : 'ผู้ชนะคะแนนรวม'}</span>
          <h2>{winnerNames}</h2><p>{winners[0]?.total ?? 0} คะแนน · จาก {room.totalRounds} รอบ</p>
        </section>}

        {intermission && <div className="intermission-bar">
          <div><h2>รอบถัดไปกำลังจะเริ่ม</h2><p>ตัวละครใหม่พร้อมแล้ว ไม่ต้องส่งเพิ่ม</p></div>
          <Countdown round={round} receivedAt={room.receivedAt} connected={connected} />
        </div>}

        {playing && <>
          <nav className="turn-queue" aria-label="ลำดับผู้เล่น">
            <span className="turn-queue__label">คิวผู้เล่น</span>
            <ol>{queue.map((player, index) => (
              <li key={player.id} className={player.id === round.activePlayerId ? 'is-active' : player.roundResult ? 'is-solved' : ''} aria-current={player.id === round.activePlayerId ? 'step' : undefined}>
                <b>{player.roundResult ? '✓' : index + 1}</b><span>{player.name}{player.isMe ? ' (คุณ)' : ''}{player.roundResult ? ` · +${player.roundResult.points}` : !player.connected ? ' · ออฟไลน์' : ''}</span>
              </li>
            ))}</ol>
          </nav>
          <div className="turn-stage">
            {current && <CharacterCard player={current} featured />}
            <aside className="turn-controls">
              <Countdown round={round} receivedAt={room.receivedAt} connected={connected} />
              {round.phase === 'voting' ? <VotePanel room={room} onVote={onVote} busy={busy} connected={connected} /> : (
                <section className="panel answer-panel">
                  <span className="section-kicker">{myTurn ? 'พร้อมตอบแล้วหรือยัง?' : me?.roundResult ? 'เก็บแต้มแล้วในรอบนี้' : 'ฟังคำถามของเพื่อน'}</span>
                  <h2>{myTurn ? 'รู้แล้วว่าฉันเป็นใคร!' : `รอ ${current?.name} กดตอบ`}</h2>
                  <p className="helper-copy">{myTurn ? 'กดปุ่มเพื่อหยุดเวลา แล้วพูดคำตอบให้เพื่อนฟัง ทุกคนจะช่วยกันโหวต' : 'ช่วยตอบคำถามระหว่างตา เมื่อเพื่อนกดตอบ คุณจะได้โหวตว่าถูกหรือผิด'}</p>
                  <button className="primary-button answer-button" onClick={() => onAnswer(round.turnId)} disabled={!myTurn || busy || !connected}><Hand size={21} />{myTurn ? 'กดตอบ' : me?.roundResult ? 'รอรอบถัดไป' : 'ยังไม่ถึงตาของคุณ'}</button>
                  <p className="answer-panel__rule">ถูกทุกเสียง = ได้แต้มตามอันดับ · ผิดทุกเสียง = เล่นต่อ<br />เสียงไม่ตรงกัน = โหวตใหม่ · คนสุดท้ายได้ 0 แต้ม</p>
                </section>
              )}
            </aside>
          </div>
        </>}

        <Scoreboard room={room} final={final} />
        {!playing && <section className="round-results" aria-label="ผลรอบล่าสุด">
          <h2>อันดับรอบที่ {round.number}</h2>
          <ol>{round.finishers.map((entry) => <li key={entry.id}><b>#{entry.rank} {entry.name}</b><span>{entry.solved ? 'ทายถูก' : 'คนสุดท้าย'} · +{entry.points} แต้ม</span></li>)}</ol>
        </section>}
        <section className="friends-section">
          <div className="section-label"><span>ตัวละครของทุกคน · รอบที่ {round.number}</span><i /></div>
          <div className="game-grid">{room.players.map((player) => <CharacterCard key={player.id} player={player} />)}</div>
        </section>
      </main>
    </div>
  )
}
