const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function normalizeRoomCode(value = '') {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function createRoomCode(existingCodes, length = 6) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = ''
    for (let i = 0; i < length; i += 1) {
      code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]
    }
    if (!existingCodes.has(code)) return code
  }
  throw new Error('ไม่สามารถสร้างรหัสห้องได้ กรุณาลองใหม่')
}

export function createDerangement(values, random = Math.random) {
  if (values.length < 2) {
    throw new Error('ต้องมีผู้เล่นอย่างน้อย 2 คน')
  }

  const result = [...values]
  // Sattolo's algorithm creates a single cycle, so no item stays in place.
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * i)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function assignCharacters(room, random = Math.random) {
  const players = [...room.players.values()]
  const ownerIds = players.map((player) => player.id)
  const assignedOwnerIds = createDerangement(ownerIds, random)

  players.forEach((player, index) => {
    const owner = room.players.get(assignedOwnerIds[index])
    player.assignedCharacter = {
      name: owner.character.name,
      imageDataUrl: owner.character.imageDataUrl,
    }
  })
}

export function publicRoomState(room, viewerId) {
  const viewer = room.players.get(viewerId)

  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    playerCount: room.players.size,
    allReady: [...room.players.values()].every((player) => Boolean(player.character)),
    allConnected: [...room.players.values()].every((player) => player.connected),
    myCharacter:
      room.status === 'waiting' && viewer?.character
        ? { ...viewer.character }
        : null,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.id === room.hostId,
      connected: player.connected,
      isReady: Boolean(player.character),
      assignedCharacter:
        room.status === 'playing' && player.id !== viewerId
          ? player.assignedCharacter
          : null,
      isMe: player.id === viewerId,
    })),
  }
}
