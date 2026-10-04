import { useEffect, useState } from 'react'
import { Clock3, Crown, Lightbulb, Trophy, Check } from 'lucide-react'

function Clock({ room }) {
  const [remaining, setRemaining] = useState(0)
  useEffect(() => {
    const update = () =>
      setRemaining(
        Math.max(
          0,
          Math.ceil(
            (room.quiz.deadlineAt -
              room.serverNow -
              (performance.now() - room.receivedAt)) /
              1000,
          ),
        ),
      )
    update()
    const timer = setInterval(update, 150)
    return () => clearInterval(timer)
  }, [room])
  return (
    <div className="quiz-clock" role="timer" aria-label="เวลาที่เหลือ">
      <Clock3 size={22} />
      <strong>
        {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
      </strong>
    </div>
  )
}

function Scores({ room }) {
  return (
    <section className="panel quiz-scores">
      <h2>
        <Trophy size={22} /> คะแนนรวม
      </h2>
      {room.standings.map((p, i) => (
        <div className="quiz-score-row" key={p.id}>
          <span>
            {i + 1}. {p.name}
            {p.departed ? ' (ออกแล้ว)' : ''}
          </span>
          <strong>{p.total} แต้ม</strong>
        </div>
      ))}
    </section>
  )
}

export default function QuizGame({ room, topbar, connected, busy, onAction }) {
  const [selected, setSelected] = useState(null)
  const me = room.players.find((p) => p.isMe)
  const quiz = room.quiz
  useEffect(() => setSelected(null), [quiz?.questionToken])
  const revealed = ['reveal', 'finished'].includes(quiz?.phase)
  const locked =
    busy ||
    !connected ||
    revealed ||
    Boolean(quiz?.myAnswer) ||
    (quiz?.phase === 'blind' && me?.requestedHint)
  return (
    <div className="room-page">
      {topbar}
      <main className="page-shell quiz-page">
        <div className="quiz-heading">
          <div>
            <span className="eyebrow">โหมดใหม่ · ใครต่างจากเพื่อน</span>
            <h1>
              {quiz
                ? `ข้อ ${quiz.number} / ${quiz.total}`
                : 'รวมแก๊ง แล้วหาคนที่ต่าง'}
            </h1>
          </div>
          {quiz?.deadlineAt && <Clock room={room} />}
        </div>
        {room.demo && (
          <p className="quiz-notice">
            โหมดสาธิต · ใช้ตัวละครสมมติ 3 ข้อ ไม่ได้เชื่อมต่อฐานข้อมูลจริง
          </p>
        )}
        <div className="quiz-players" aria-label="สถานะผู้เล่น">
          {room.players.map((p) => (
            <span key={p.id} className={p.answered ? 'done' : ''}>
              {p.isHost && <Crown size={14} />}
              {p.name}
              {p.isMe && ' (คุณ)'} ·{' '}
              {!p.connected
                ? 'ออฟไลน์'
                : p.answered
                  ? 'ตอบแล้ว'
                  : p.requestedHint
                    ? 'ขอคำใบ้'
                    : 'รอ'}
            </span>
          ))}
        </div>
        {!quiz ? (
          <section className="panel quiz-lobby">
            <h2>กติกาห้องนี้</h2>
            <p>
              {room.settings.questionCount} ข้อ · ตอบได้ครั้งเดียวต่อข้อ ·
              เฉลยพร้อมกันเมื่อจบข้อ
            </p>
            <div className="quiz-rule-grid">
              <div>
                <strong>ไม่ใช้คำใบ้</strong>
                <b>{room.settings.blindSeconds} วินาที</b>
                <span>ตอบถูก +3 แต้ม</span>
              </div>
              <div>
                <strong>เปิดคำใบ้</strong>
                <b>{room.settings.hintSeconds} วินาที</b>
                <span>ตอบถูก +1 แต้ม</span>
              </div>
            </div>
            <p className="helper-copy">
              เมื่อทุกคนตอบหรือขอคำใบ้ จะข้ามช่วงแรกทันที
              กดขอคำใบ้แล้วต้องรอช่วงคำใบ้และได้สูงสุด 1 แต้ม ผิดหรือไม่ตอบได้ 0
              แต้ม
            </p>
            {me?.isHost ? (
              <button
                className="primary-button"
                disabled={
                  busy ||
                  !connected ||
                  room.playerCount < 2 ||
                  !room.allConnected
                }
                onClick={() => onAction('quizStart')}
              >
                เริ่มเกม · {room.playerCount} คน
              </button>
            ) : (
              <p>รอโฮสต์เริ่มเกม</p>
            )}
          </section>
        ) : (
          <>
            <section className="quiz-question">
              <h2>{quiz.question.title}</h2>
              <p className="quiz-phase" aria-live="polite">
                {revealed
                  ? 'เฉลยพร้อมกัน'
                  : quiz.phase === 'blind'
                    ? 'ยังไม่มีคำใบ้ · ตอบถูก 3 แต้ม'
                    : 'ช่วงคำใบ้ · ตอบถูก 1 แต้ม'}
              </p>
              {quiz.hint && (
                <div className="quiz-hint">
                  <Lightbulb size={22} /> คำใบ้: <strong>{quiz.hint}</strong>
                </div>
              )}
              <div className="quiz-options">
                {quiz.question.options.map((option, i) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`quiz-option ${selected === option.id || quiz.myAnswer === option.id ? 'selected' : ''} ${revealed && quiz.correctOptionId === option.id ? 'correct' : ''}`}
                    disabled={locked}
                    aria-pressed={
                      selected === option.id || quiz.myAnswer === option.id
                    }
                    onClick={() => setSelected(option.id)}
                  >
                    <span className="quiz-option-letter">
                      {['A', 'B', 'C', 'D'][i]}
                    </span>
                    <img src={option.imageUrl} alt={option.name} />
                    <strong>{option.name}</strong>
                    <small>{option.source}</small>
                    {revealed && quiz.correctOptionId === option.id && (
                      <span className="quiz-correct-label">
                        <Check size={16} /> คำตอบที่ถูก
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {!revealed && (
                <div className="quiz-answer-bar">
                  {quiz.myAnswer ? (
                    <p role="status">ยืนยันคำตอบแล้ว รอเฉลยพร้อมกัน</p>
                  ) : me?.requestedHint && quiz.phase === 'blind' ? (
                    <p role="status">
                      ขอคำใบ้แล้ว รอเพื่อนตอบหรือขอคำใบ้ครบทุกคน
                    </p>
                  ) : (
                    <>
                      <button
                        className="primary-button"
                        disabled={locked || !selected}
                        onClick={() =>
                          onAction('quizAnswer', {
                            questionToken: quiz.questionToken,
                            optionId: selected,
                          })
                        }
                      >
                        ยืนยันคำตอบ · เปลี่ยนไม่ได้
                      </button>
                      {quiz.phase === 'blind' && (
                        <button
                          className="secondary-button"
                          disabled={locked}
                          onClick={() =>
                            onAction('quizHint', {
                              questionToken: quiz.questionToken,
                            })
                          }
                        >
                          <Lightbulb size={18} /> ขอคำใบ้ · เหลือสิทธิ์ 1 แต้ม
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>
            {revealed && (
              <section className="panel quiz-reveal">
                <h2>
                  {quiz.phase === 'finished' ? 'จบเกมแล้ว!' : 'เฉลยข้อนี้'}
                </h2>
                <p>{quiz.explanation}</p>
                {quiz.result.rows.map((p) => (
                  <div className="quiz-score-row" key={p.id}>
                    <span>
                      {p.name} ·{' '}
                      {p.optionId
                        ? p.correct
                          ? 'ตอบถูก'
                          : 'ตอบผิด'
                        : 'ไม่ได้ตอบ'}
                    </span>
                    <strong>+{p.points}</strong>
                  </div>
                ))}
                {quiz.phase === 'finished' && (
                  <h3>
                    ผู้ชนะ{room.winnerIds.length > 1 ? 'ร่วม' : ''}:{' '}
                    {room.standings
                      .filter((p) => room.winnerIds.includes(p.id))
                      .map((p) => p.name)
                      .join(', ')}
                  </h3>
                )}
                {me?.isHost &&
                  (quiz.phase === 'finished' ? (
                    <button
                      className="primary-button"
                      disabled={busy || !connected}
                      onClick={() => {
                        if (window.confirm('กลับห้องรอและล้างคะแนนเกมนี้?'))
                          onAction('resetGame')
                      }}
                    >
                      กลับห้องรอ
                    </button>
                  ) : (
                    <button
                      className="primary-button"
                      disabled={busy || !connected}
                      onClick={() =>
                        onAction('quizNext', {
                          questionToken: quiz.questionToken,
                        })
                      }
                    >
                      ไปข้อถัดไป
                    </button>
                  ))}
              </section>
            )}
            <Scores room={room} />
          </>
        )}
      </main>
    </div>
  )
}
