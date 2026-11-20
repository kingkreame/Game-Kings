import { Chess, type Move, type Square } from 'chess.js'
import { Sfx } from './audio.js'
import { BoardFx } from './effects.js'
import { pieceSvg } from './pieces.js'
import { applyUci, castleRook, epCapturedSquare, kingSquare, moveToUci } from '../shared/game.js'
import { EFFECTS, PIECE_STYLES, THEMES } from '../shared/themes.js'
import {
  TERMS,
  type Color,
  type EffectPackId,
  type GameView,
  type PassStatus,
  type PieceStyleId,
  type PieceSymbol,
  type PremiumDifficulty,
  type ThemeId,
} from '../shared/types.js'

const GLIDE_MS = 560
const CROWN = `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#e8c872" d="M32 6h6v10h8v6h-8v4h14l-6 10H18L12 26h14v-4h-8v-6h8V6z"/><path fill="#e8c872" d="M14 40h36l4 14H10z"/><rect x="10" y="54" width="44" height="6" rx="2" fill="#f3e2a9"/></svg>`

const sfx = new Sfx()
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('Missing app root')
const app: HTMLElement = root

const state = {
  pass: null as PassStatus | null,
  screen: 'menu' as 'menu' | 'play',
  mode: 'pass' as 'pass' | 'easy' | 'premium',
  chess: new Chess(),
  human: 'w' as Color,
  colorChoice: 'w' as Color,
  flipped: false,
  selected: null as string | null,
  last: null as { from: string; to: string } | null,
  theme: 'classic' as ThemeId,
  style: 'classic' as PieceStyleId,
  effect: 'core' as EffectPackId,
  busy: false,
  thinking: false,
  thinkToken: 0,
  note: '',
}

let fx: BoardFx | null = null
let boardEvents: AbortController | null = null
let worker: Worker | null = null

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function muteLabel(): string {
  return sfx.muted ? 'Unmute sound' : 'Mute sound'
}

function speaker(): string {
  if (sfx.muted) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3 9h4l5-4v14l-5-4H3z"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M16 9l5 6M21 9l-5 6"/></svg>`
  }
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3 9h4l5-4v14l-5-4H3z"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M16 9a4 4 0 0 1 0 6M18.5 7a7 7 0 0 1 0 10"/></svg>`
}

function shell(): void {
  app.innerHTML = `<header class="header"><div class="brand">${CROWN}<h1>Game Kings Chess</h1></div><button class="icon-btn" type="button" data-action="mute" aria-pressed="${sfx.muted}" aria-label="${muteLabel()}">${speaker()}</button></header><div id="view"></div><div id="sheet" class="sheet" hidden></div><div id="confirm" class="sheet" hidden></div>`
}

function paintMute(): void {
  const button = app.querySelector<HTMLButtonElement>('[data-action="mute"]')
  if (!button) return
  button.setAttribute('aria-pressed', String(sfx.muted))
  button.setAttribute('aria-label', muteLabel())
  button.innerHTML = speaker()
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(data.error || 'Request failed.')
  return data
}

function price(): string {
  return state.pass?.priceLabel || '$4.99'
}

function terms(): string {
  return state.pass?.terms || TERMS
}

function premiumLive(): boolean {
  return Boolean(state.pass?.gateEnabled && state.pass.game && !state.pass.game.result)
}

function activeTheme(): ThemeId {
  return state.mode === 'premium' ? state.theme : 'classic'
}

function activeStyle(): PieceStyleId {
  return state.mode === 'premium' ? state.style : 'classic'
}

function activeEffect(): EffectPackId {
  return state.mode === 'premium' ? state.effect : 'core'
}

function describe(): string {
  const game = state.mode === 'premium' ? state.pass?.game : null
  if (game?.result === 'win') return 'Checkmate. You win. Your next premium game is free.'
  if (game?.result === 'loss') return 'Checkmate. No replay credit.'
  if (game?.result === 'draw') return 'Draw. No replay credit.'
  if (game?.result === 'resign') return 'You resigned. No replay credit.'
  if (game?.result === 'timeout') return 'Forfeited after 30 minutes idle. No replay credit.'
  if (state.note) return state.note
  if (state.chess.isCheckmate()) {
    const winner = state.chess.turn() === 'w' ? 'Black' : 'White'
    return `Checkmate. ${winner} wins.`
  }
  if (state.chess.isStalemate()) return 'Stalemate. Draw.'
  if (state.chess.isThreefoldRepetition()) return 'Draw by threefold repetition.'
  if (state.chess.isInsufficientMaterial()) return 'Draw by insufficient material.'
  if (state.chess.isDraw()) return 'Draw by the fifty-move rule.'
  if (state.thinking) return 'Computer is thinking…'
  if (state.chess.isCheck()) return 'Check.'
  if (state.mode === 'pass') return `${state.chess.turn() === 'w' ? 'White' : 'Black'} to move.`
  return state.chess.turn() === state.human ? 'Your move.' : 'Computer is thinking…'
}

function renderMenu(): void {
  boardEvents?.abort()
  fx = null
  state.screen = 'menu'
  const view = document.querySelector('#view')
  if (!view) return
  const gate = Boolean(state.pass?.gateEnabled)
  const credits = gate ? (state.pass?.credits ?? 0) : 0
  const soon = gate ? 'Premium' : 'Coming soon'
  view.innerHTML = `<div class="menu" data-screen="menu"><p class="lede">Pass-and-play on one phone, or an easy computer game. No accounts, no ads, no cash prizes.</p><p class="section-label">Free</p><div class="stack"><button type="button" class="choice" data-action="pass"><span>Pass and play</span><span class="badge free">Free</span></button><button type="button" class="choice" data-action="easy"><span>Vs computer · Easy</span><span class="badge free">Free</span></button><button type="button" data-action="color" aria-pressed="${state.colorChoice === 'b'}">Play Easy as ${state.colorChoice === 'w' ? 'White' : 'Black'}</button></div><p class="section-label">Premium · ${escapeText(price())} a game</p><div class="stack" data-coming="premium">${(['medium', 'hard', 'expert'] as const).map((level) => `<button type="button" class="choice" data-action="open-premium" data-level="${level}"><span>Vs computer · ${level[0].toUpperCase()}${level.slice(1)}</span><span class="badge">${soon}</span></button>`).join('')}${premiumLive() ? `<button type="button" class="primary" data-action="resume">Resume premium game</button>` : ''}${gate && credits > 0 ? `<p class="fine">You have ${credits} premium credit${credits === 1 ? '' : 's'}.</p>` : ''}</div><p class="section-label">Boards, pieces, effects</p><div class="chips" data-coming="premium">${THEMES.map((theme) => `<button type="button" class="chip" data-action="${theme.premium ? 'open-premium' : 'noop'}" data-theme="${theme.id}" ${theme.premium ? '' : 'aria-pressed="true"'}>${theme.name}${theme.premium ? ` · ${soon}` : ''}</button>`).join('')}${PIECE_STYLES.map((style) => `<button type="button" class="chip" data-action="${style.premium ? 'open-premium' : 'noop'}" ${style.premium ? '' : 'aria-pressed="true"'}>${style.name}${style.premium ? ` · ${soon}` : ''}</button>`).join('')}${EFFECTS.map((effect) => `<button type="button" class="chip" data-action="${effect.premium ? 'open-premium' : 'noop'}" ${effect.premium ? '' : 'aria-pressed="true"'}>${effect.name}${effect.premium ? ` · ${soon}` : ''}</button>`).join('')}</div><p class="terms">${escapeText(terms())}</p><p class="fine">Original piece art is CC0. Rules use chess.js (BSD-2-Clause).</p>${state.note ? `<p class="alert">${escapeText(state.note)}</p>` : ''}</div>`
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

function openSheet(level?: PremiumDifficulty): void {
  const sheet = document.querySelector<HTMLElement>('#sheet')
  if (!sheet) return
  const gate = Boolean(state.pass?.gateEnabled)
  const credits = gate ? (state.pass?.credits ?? 0) : 0
  const checkout = gate ? state.pass?.checkoutUrl || '' : ''
  const look = credits > 0 ? `<p class="section-label">Look for this game</p><div class="chips">${THEMES.map((theme) => `<button type="button" class="chip" data-action="pick-theme" data-theme="${theme.id}" aria-pressed="${state.theme === theme.id}">${theme.name}</button>`).join('')}${PIECE_STYLES.map((style) => `<button type="button" class="chip" data-action="pick-style" data-style="${style.id}" aria-pressed="${state.style === style.id}">${style.name}</button>`).join('')}${EFFECTS.map((effect) => `<button type="button" class="chip" data-action="pick-effect" data-effect="${effect.id}" aria-pressed="${state.effect === effect.id}">${effect.name}</button>`).join('')}</div>` : ''
  const starts = credits > 0 ? `<div class="stack">${(['medium', 'hard', 'expert'] as const).map((item) => `<button type="button" class="primary" data-action="start-premium" data-level="${item}">Use 1 credit · ${item[0].toUpperCase()}${item.slice(1)}</button>`).join('')}</div>` : ''
  const buy = gate
    ? `${checkout ? `<a class="buy-link" href="${escapeText(checkout)}" rel="noopener noreferrer">Buy a premium game</a>` : '<p class="fine">The checkout link is not configured yet. A license key can still be redeemed.</p>'}<form data-action="redeem"><label for="license-key">Gumroad license key</label><input id="license-key" name="licenseKey" autocomplete="off" spellcheck="false" maxlength="80" placeholder="Paste your key" /><div class="row"><button type="submit" class="primary">Redeem one game</button></div><p class="alert" data-alert></p></form>${starts}`
    : `<button type="button" disabled>Coming soon</button>`
  sheet.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="prem-title"><h2 id="prem-title">Premium game</h2><p class="price">${escapeText(price())}</p><p class="terms">${escapeText(terms())}</p><p>One purchase is one game of Medium, Hard, or Expert, with the extra boards, piece styles, and capture effects for that game. Win and the next premium game is free. No cash, no payouts, no prizes of monetary value.</p>${look}${buy}<div class="row"><button type="button" data-action="close-sheet">Close</button><button type="button" data-action="color">Play as ${state.colorChoice === 'w' ? 'White' : 'Black'}</button></div>${level ? `<p class="fine">Selected: ${level}</p>` : ''}</div>`
  sheet.hidden = false
}

function confirmBox(text: string): Promise<boolean> {
  const root = document.querySelector<HTMLElement>('#confirm')
  if (!root) return Promise.resolve(false)
  root.innerHTML = `<div class="panel" role="dialog" aria-modal="true"><p>${escapeText(text)}</p><div class="row"><button type="button" data-action="confirm-no">Not now</button><button type="button" class="primary" data-action="confirm-yes">Continue</button></div></div>`
  root.hidden = false
  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      root.removeEventListener('click', onClick)
      root.hidden = true
      root.innerHTML = ''
      resolve(value)
    }
    const onClick = (event: Event) => {
      const target = (event.target as HTMLElement).closest('[data-action]')
      const action = target?.getAttribute('data-action')
      if (action === 'confirm-yes') finish(true)
      if (action === 'confirm-no') finish(false)
    }
    root.addEventListener('click', onClick)
  })
}

function renderPlay(): void {
  state.screen = 'play'
  const view = document.querySelector('#view')
  if (!view) return
  view.innerHTML = `<div class="play" data-screen="play"><div class="board-column"><p class="status" role="status" data-status></p><div class="tray top"></div><div class="board-wrap"><div class="board" data-board data-anim=""><div class="squares" data-squares></div><canvas class="fx" data-fx></canvas><div class="flash" data-flash></div><div class="streak" data-streak hidden></div><div class="pieces" data-pieces></div><div class="ripples" data-ripples></div><div class="mate" data-mate hidden>${CROWN.replace('<svg ', '<svg class="crown-burst" ')}<h2>Checkmate</h2><p data-mate-text></p></div></div></div><div class="tray bottom"></div></div><aside class="side"><div class="moves" data-moves></div><div class="controls"><button type="button" data-action="undo">Undo</button><button type="button" data-action="flip">Flip</button><button type="button" data-action="new">New game</button><button type="button" data-action="menu">Menu</button>${state.mode === 'premium' ? '<button type="button" data-action="resign">Resign</button>' : ''}</div><div data-look></div><div class="promo" data-promo hidden></div></aside></div>`
  const board = view.querySelector<HTMLElement>('[data-board]')
  const canvas = view.querySelector<HTMLCanvasElement>('[data-fx]')
  const streak = view.querySelector<HTMLElement>('[data-streak]')
  const flash = view.querySelector<HTMLElement>('[data-flash]')
  const ripples = view.querySelector<HTMLElement>('[data-ripples]')
  if (board && canvas && streak && flash && ripples) {
    fx = new BoardFx(canvas, streak, flash, ripples)
    fx.resize()
  }
  boardEvents?.abort()
  boardEvents = new AbortController()
  board?.addEventListener('pointerdown', onPointerDown, { signal: boardEvents.signal })
  board?.addEventListener('pointermove', onPointerMove, { signal: boardEvents.signal })
  board?.addEventListener('pointerup', onPointerUp, { signal: boardEvents.signal })
  board?.addEventListener('pointercancel', onPointerUp, { signal: boardEvents.signal })
  applyTheme()
  buildSquares()
  drawAll()
}

function boardEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-board]')
}

function visual(square: string): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97
  const rank = Number(square[1]) - 1
  return { x: state.flipped ? 7 - file : file, y: state.flipped ? rank : 7 - rank }
}

function applyTheme(): void {
  const board = boardEl()
  const theme = THEMES.find((item) => item.id === activeTheme()) ?? THEMES[0]
  if (!board) return
  board.style.setProperty('--light', theme.light)
  board.style.setProperty('--dark', theme.dark)
  board.style.setProperty('--last', theme.last)
  board.style.setProperty('--dot', theme.dot)
  board.style.setProperty('--dot-dark', theme.dotDark)
  board.style.setProperty('--frame', theme.frame)
  board.dataset.theme = theme.id
}

function buildSquares(): void {
  const host = document.querySelector('[data-squares]')
  if (!host) return
  host.innerHTML = ''
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const file = state.flipped ? 7 - x : x
      const rank = state.flipped ? y : 7 - y
      const sq = `${'abcdefgh'[file]}${rank + 1}`
      const cell = document.createElement('div')
      const dark = (file + rank) % 2 === 0
      cell.className = `sq ${dark ? 'dark' : 'light'}`
      cell.dataset.sq = sq
      cell.setAttribute('role', 'gridcell')
      if (y === 7) {
        const label = document.createElement('span')
        label.className = 'coord file'
        label.textContent = 'abcdefgh'[file]
        cell.appendChild(label)
      }
      if (x === 0) {
        const label = document.createElement('span')
        label.className = 'coord rank'
        label.textContent = String(rank + 1)
        cell.appendChild(label)
      }
      host.appendChild(cell)
    }
  }
}

function orientTrays(): void {
  const trays = document.querySelectorAll<HTMLElement>('.tray')
  const top = trays[0]
  const bottom = trays[1]
  if (!top || !bottom) return
  top.dataset.tray = state.flipped ? 'w' : 'b'
  bottom.dataset.tray = state.flipped ? 'b' : 'w'
}

function drawPieces(): void {
  const host = document.querySelector('[data-pieces]')
  if (!host) return
  host.innerHTML = ''
  const style = activeStyle()
  for (const row of state.chess.board()) {
    for (const cell of row) {
      if (!cell) continue
      const el = document.createElement('div')
      el.className = `piece style-${style}`
      el.dataset.sq = cell.square
      el.dataset.color = cell.color
      el.dataset.type = cell.type
      const pos = visual(cell.square)
      el.style.setProperty('--f', String(pos.x))
      el.style.setProperty('--r', String(pos.y))
      el.innerHTML = pieceSvg(cell.type, cell.color, style)
      el.setAttribute('aria-hidden', 'true')
      host.appendChild(el)
    }
  }
}

function paintSquares(): void {
  const selected = state.selected
  const legal = new Map<string, boolean>()
  if (selected && /^[a-h][1-8]$/.test(selected)) {
    for (const move of state.chess.moves({ verbose: true, square: selected as Square })) {
      legal.set(move.to, Boolean(move.captured))
    }
  }
  const check = state.chess.isCheck() ? kingSquare(state.chess, state.chess.turn()) : null
  document.querySelectorAll<HTMLElement>('.sq').forEach((cell) => {
    const sq = cell.dataset.sq || ''
    cell.classList.toggle('last', state.last?.from === sq || state.last?.to === sq)
    cell.classList.toggle('selected', selected === sq)
    cell.classList.toggle('dot', legal.has(sq) && !legal.get(sq))
    cell.classList.toggle('cap', Boolean(legal.get(sq)))
    cell.classList.toggle('check', check === sq)
    const piece = /^[a-h][1-8]$/.test(sq) ? state.chess.get(sq as Square) : undefined
    cell.setAttribute('aria-label', piece ? `${sq} ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : `${sq} empty`)
  })
}

function updateMoves(): void {
  const host = document.querySelector('[data-moves]')
  if (!host) return
  const sans = state.mode === 'premium' && state.pass?.game ? state.pass.game.movesSan : state.chess.history()
  host.innerHTML = ''
  if (!sans.length) {
    const empty = document.createElement('span')
    empty.textContent = 'Moves will appear here.'
    host.appendChild(empty)
    return
  }
  for (let i = 0; i < sans.length; i += 2) {
    const item = document.createElement('span')
    const num = document.createElement('span')
    num.className = 'move-no'
    num.textContent = `${i / 2 + 1}.`
    item.append(num, document.createTextNode(` ${sans[i]}${sans[i + 1] ? ` ${sans[i + 1]}` : ''}`))
    host.appendChild(item)
  }
}

function updateTrays(): void {
  orientTrays()
  const taken = { w: [] as PieceSymbol[], b: [] as PieceSymbol[] }
  for (const move of state.chess.history({ verbose: true })) {
    if (!move.captured) continue
    taken[move.color].push(move.captured)
  }
  for (const color of ['w', 'b'] as const) {
    const tray = document.querySelector<HTMLElement>(`[data-tray="${color}"]`)
    if (!tray) continue
    tray.innerHTML = ''
    for (const type of taken[color]) {
      const mini = document.createElement('span')
      mini.className = 'mini'
      mini.innerHTML = pieceSvg(type, color === 'w' ? 'b' : 'w', activeStyle())
      tray.appendChild(mini)
    }
  }
}

function updateStatus(): void {
  const status = document.querySelector('[data-status]')
  if (status) status.textContent = describe()
  const mateText = document.querySelector('[data-mate-text]')
  if (mateText) mateText.textContent = describe()
  const undo = document.querySelector<HTMLButtonElement>('[data-action="undo"]')
  if (undo) undo.disabled = state.busy || !canUndo()
}

function drawAll(): void {
  applyTheme()
  drawPieces()
  paintSquares()
  updateMoves()
  updateTrays()
  updateStatus()
  renderLook()
}

function renderLook(): void {
  const host = document.querySelector('[data-look]')
  if (!host) return
  if (state.mode !== 'premium') {
    host.innerHTML = '<p class="fine">Classic royal board and pieces.</p>'
    return
  }
  host.innerHTML = `<p class="section-label">This game</p><div class="chips">${THEMES.map((theme) => `<button type="button" class="chip" data-action="live-theme" data-theme="${theme.id}" aria-pressed="${state.theme === theme.id}">${theme.name}</button>`).join('')}${PIECE_STYLES.map((style) => `<button type="button" class="chip" data-action="live-style" data-style="${style.id}" aria-pressed="${state.style === style.id}">${style.name}</button>`).join('')}${EFFECTS.map((effect) => `<button type="button" class="chip" data-action="live-effect" data-effect="${effect.id}" aria-pressed="${state.effect === effect.id}">${effect.name}</button>`).join('')}</div>`
}

function canUndo(): boolean {
  if (state.chess.isGameOver() && state.mode !== 'pass') return false
  if (state.mode === 'premium' && state.pass?.game?.result) return false
  if (state.mode === 'pass') return state.chess.history().length > 0
  return state.chess.history({ verbose: true }).some((move) => move.color === state.human)
}

function squareFromPoint(clientX: number, clientY: number): string | null {
  const board = boardEl()
  if (!board) return null
  const rect = board.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null
  const file = Math.min(7, Math.floor((x / rect.width) * 8))
  const rankFromTop = Math.min(7, Math.floor((y / rect.height) * 8))
  const f = state.flipped ? 7 - file : file
  const r = state.flipped ? rankFromTop : 7 - rankFromTop
  return `${'abcdefgh'[f]}${r + 1}`
}

function pieceBySquare(square: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.piece[data-sq="${square}"]`)
}

let drag: { from: string; x: number; y: number; moved: boolean; id: number } | null = null

function controls(color: Color): boolean {
  if (state.busy || state.chess.isGameOver()) return false
  if (state.mode === 'pass') return color === state.chess.turn()
  return color === state.human && state.chess.turn() === state.human
}

function onPointerDown(event: PointerEvent): void {
  if (state.busy || event.button !== 0) return
  const board = boardEl()
  const square = squareFromPoint(event.clientX, event.clientY)
  if (!board || !square) return
  board.setPointerCapture(event.pointerId)
  const piece = /^[a-h][1-8]$/.test(square) ? state.chess.get(square as Square) : undefined
  if (piece && controls(piece.color)) {
    drag = { from: square, x: event.clientX, y: event.clientY, moved: false, id: event.pointerId }
    state.selected = square
    paintSquares()
    return
  }
  drag = { from: '', x: event.clientX, y: event.clientY, moved: false, id: event.pointerId }
}

function onPointerMove(event: PointerEvent): void {
  if (!drag?.from || event.pointerId !== drag.id) return
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return
  drag.moved = true
  const el = pieceBySquare(drag.from)
  const board = boardEl()
  if (!el || !board) return
  const rect = board.getBoundingClientRect()
  const size = rect.width / 8
  el.classList.add('dragging')
  el.style.setProperty('--x', `${event.clientX - rect.left - size / 2}px`)
  el.style.setProperty('--y', `${event.clientY - rect.top - size / 2}px`)
}

function onPointerUp(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return
  const from = drag.from
  const moved = drag.moved
  drag = null
  const square = squareFromPoint(event.clientX, event.clientY)
  if (from && moved && square && square !== from) {
    void tryMove(from, square)
    return
  }
  if (from && !moved && state.selected && state.selected !== from && legalBetween(state.selected, from)) {
    void tryMove(state.selected, from)
    return
  }
  if (from && !moved) {
    state.selected = from
    drawPieces()
    paintSquares()
    return
  }
  if (state.selected && square && legalBetween(state.selected, square)) {
    void tryMove(state.selected, square)
    return
  }
  state.selected = null
  drawPieces()
  paintSquares()
}

function legalBetween(from: string, to: string): boolean {
  if (!/^[a-h][1-8]$/.test(from)) return false
  return state.chess.moves({ verbose: true, square: from as Square }).some((move) => move.to === to)
}

async function tryMove(from: string, to: string): Promise<void> {
  if (state.busy) return
  const options = /^[a-h][1-8]$/.test(from)
    ? state.chess.moves({ verbose: true, square: from as Square }).filter((move) => move.to === to)
    : []
  if (!options.length) {
    state.selected = null
    drawPieces()
    paintSquares()
    return
  }
  state.busy = true
  state.selected = null
  document.querySelectorAll('.piece.dragging').forEach((el) => el.classList.remove('dragging'))
  paintSquares()
  try {
    let promotion: string | undefined
    if (options.some((move) => move.promotion)) {
      const choice = await askPromotion(state.chess.turn())
      if (!choice) {
        drawAll()
        return
      }
      promotion = choice
    }
    const chosen = options.find((move) => (move.promotion ?? undefined) === promotion) ?? options[0]
    if (state.mode === 'premium') await sendPremium(`${from}${to}${promotion ?? ''}`)
    else await playLocal(chosen)
  } catch (error) {
    state.note = error instanceof Error ? error.message : 'That move was rejected.'
    drawAll()
  } finally {
    state.busy = false
    updateStatus()
  }
}

function askPromotion(color: Color): Promise<PieceSymbol | null> {
  const host = document.querySelector<HTMLElement>('[data-promo]')
  if (!host) return Promise.resolve('q')
  host.hidden = false
  host.innerHTML = (['q', 'r', 'b', 'n'] as const).map((type) => `<button type="button" data-promo="${type}" aria-label="${type}">${pieceSvg(type, color, activeStyle())}</button>`).join('')
  return new Promise((resolve) => {
    const finish = (value: PieceSymbol | null) => {
      host.hidden = true
      host.innerHTML = ''
      resolve(value)
    }
    host.onclick = (event) => {
      const button = (event.target as HTMLElement).closest('[data-promo]')
      const value = button?.getAttribute('data-promo')
      if (value === 'q' || value === 'r' || value === 'b' || value === 'n') finish(value)
    }
  })
}

async function playLocal(move: Move): Promise<void> {
  state.chess.move({ from: move.from, to: move.to, promotion: move.promotion })
  await animateMove(move)
  if (!state.chess.isGameOver() && state.mode === 'easy') await runAi()
}

async function runAi(): Promise<void> {
  const token = ++state.thinkToken
  const alreadyBusy = state.busy
  state.busy = true
  state.thinking = true
  updateStatus()
  try {
    const uci = await think(state.chess.fen())
    state.thinking = false
    if (token !== state.thinkToken || !uci) return
    const move = applyUci(state.chess, uci)
    if (!move) return
    await animateMove(move)
  } finally {
    state.thinking = false
    if (!alreadyBusy) state.busy = false
    updateStatus()
  }
}

function think(fen: string): Promise<string | null> {
  const current = ensureWorker()
  if (!current) return Promise.resolve(fallbackEasy(fen))
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      current.removeEventListener('message', onMessage)
      resolve(fallbackEasy(fen))
    }, 5000)
    const onMessage = (event: MessageEvent<{ uci: string | null }>) => {
      window.clearTimeout(timer)
      current.removeEventListener('message', onMessage)
      resolve(event.data.uci)
    }
    current.addEventListener('message', onMessage)
    current.postMessage({ fen })
  })
}

function ensureWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' })
    return worker
  } catch {
    return null
  }
}

function fallbackEasy(fen: string): string | null {
  try {
    const chess = new Chess(fen)
    const moves = chess.moves({ verbose: true })
    if (!moves.length) return null
    return moveToUci(moves[Math.floor(Math.random() * moves.length)])
  } catch {
    return null
  }
}

async function sendPremium(uci: string): Promise<void> {
  const game = state.pass?.game
  if (!game) return
  const response = await api<{ credits: number; applied?: string[]; game: GameView | null }>('/api/game/move', {
    gameId: game.id,
    uci,
  })
  await revealServer(response.applied ?? [], response.game, response.credits)
}

async function revealServer(applied: string[], game: GameView | null, credits: number): Promise<void> {
  for (const uci of applied) {
    const move = applyUci(state.chess, uci)
    if (!move) break
    await animateMove(move)
  }
  if (state.pass) {
    state.pass.credits = credits
    state.pass.game = game
  }
  if (game && state.chess.fen() !== game.fen) {
    try {
      state.chess.load(game.fen)
    } catch {
      /* keep the replayed line */
    }
  }
  state.last = game?.lastMove ?? state.last
  if (game?.result === 'win' || game?.result === 'loss' || state.chess.isCheckmate()) showMate(!reduced.matches)
  drawAll()
}

async function animateMove(move: Move): Promise<void> {
  const board = boardEl()
  if (!board) return
  const quiet = reduced.matches
  if (move.isCapture()) sfx.capture()
  else if (move.isKingsideCastle() || move.isQueensideCastle()) sfx.castle()
  else sfx.move()
  if (move.promotion) sfx.promote()
  board.dataset.anim = quiet ? '' : 'glide'
  if (!quiet) {
    const mover = pieceBySquare(move.from)
    const rook = castleRook(move)
    fx?.startTrail()
    const jobs: Promise<void>[] = []
    if (mover) jobs.push(glide(mover, move.from, move.to, move.piece))
    if (rook) {
      const rookEl = pieceBySquare(rook.from)
      if (rookEl) jobs.push(glide(rookEl, rook.from, rook.to, 'r'))
    }
    await Promise.all(jobs)
    fx?.endTrail()
    const pos = visual(move.to)
    const size = board.clientWidth / 8
    fx?.ripple((pos.x + 0.5) * size, (pos.y + 0.5) * size)
    const captured = move.isEnPassant() ? epCapturedSquare(move) : move.isCapture() ? move.to : null
    if (captured) {
      board.dataset.anim = 'capture'
      const capEl = pieceBySquare(captured)
      fx?.flash()
      fx?.shake(board)
      const at = visual(captured)
      fx?.capture((at.x + 0.5) * size, (at.y + 0.5) * size, activeEffect())
      if (capEl) flyPiece(capEl, move.color)
      await wait(720)
    }
  }
  state.last = { from: move.from, to: move.to }
  drawPieces()
  paintSquares()
  updateMoves()
  updateTrays()
  pieceBySquare(move.to)?.classList.add('glow')
  window.setTimeout(() => pieceBySquare(move.to)?.classList.remove('glow'), 700)
  if (state.chess.isCheckmate()) {
    board.dataset.anim = 'mate'
    showMate(!quiet)
    sfx.mate()
  } else {
    if (board.dataset.anim !== 'mate') board.dataset.anim = ''
    if (state.chess.isCheck()) sfx.check()
  }
  updateStatus()
}

function glide(el: HTMLElement, from: string, to: string, piece: string): Promise<void> {
  const start = visual(from)
  const end = visual(to)
  const knight = piece === 'n'
  el.classList.add('gliding')
  return new Promise((resolve) => {
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / GLIDE_MS)
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      const dx = end.x - start.x
      const dy = end.y - start.y
      const len = Math.hypot(dx, dy) || 1
      const arc = knight ? Math.sin(Math.PI * eased) * 0.62 : 0
      const x = start.x + dx * eased + (-dy / len) * arc
      const y = start.y + dy * eased + (dx / len) * arc
      el.style.setProperty('--f', String(x))
      el.style.setProperty('--r', String(y))
      const board = boardEl()
      if (board && piece !== 'r') {
        const size = board.clientWidth / 8
        fx?.trailTo((x + 0.5) * size, (y + 0.5) * size)
      }
      if (t < 1) requestAnimationFrame(step)
      else {
        el.style.setProperty('--f', String(end.x))
        el.style.setProperty('--r', String(end.y))
        el.classList.remove('gliding')
        resolve()
      }
    }
    requestAnimationFrame(step)
  })
}

function flyPiece(el: HTMLElement, capturer: Color): void {
  const tray = document.querySelector<HTMLElement>(`[data-tray="${capturer}"]`)
  if (!tray) return
  const from = el.getBoundingClientRect()
  const to = tray.getBoundingClientRect()
  const ghost = el.cloneNode(true) as HTMLElement
  ghost.classList.remove('dragging', 'gliding')
  ghost.classList.add('fly-piece')
  ghost.style.left = `${from.left}px`
  ghost.style.top = `${from.top}px`
  ghost.style.width = `${from.width}px`
  ghost.style.height = `${from.height}px`
  document.body.appendChild(ghost)
  el.style.visibility = 'hidden'
  requestAnimationFrame(() => {
    ghost.style.left = `${to.left + Math.max(0, to.width - from.width)}px`
    ghost.style.top = `${to.top}px`
  })
  window.setTimeout(() => ghost.remove(), 520)
}

function showMate(animate: boolean): void {
  const mate = document.querySelector<HTMLElement>('[data-mate]')
  const board = boardEl()
  if (!mate) return
  mate.hidden = false
  board?.classList.add('celebrating')
  mate.querySelector('.crown-burst')?.classList.toggle('burst', animate)
  const text = mate.querySelector('[data-mate-text]')
  if (text) text.textContent = describe()
  if (animate) fx?.celebrate()
}

function beginPass(): void {
  state.thinkToken++
  state.mode = 'pass'
  state.human = 'w'
  state.chess.reset()
  state.flipped = false
  state.selected = null
  state.last = null
  state.note = ''
  state.busy = false
  renderPlay()
}

function beginEasy(): void {
  state.thinkToken++
  state.mode = 'easy'
  state.human = state.colorChoice
  state.chess.reset()
  state.flipped = state.human === 'b'
  state.selected = null
  state.last = null
  state.note = ''
  state.busy = false
  renderPlay()
  if (state.human === 'b') void runAi()
}

async function beginPremium(level: PremiumDifficulty): Promise<void> {
  const ok = await confirmBox('Use 1 premium credit? If you win, your next premium game is free. A loss, draw, resign, or 30-minute idle forfeit does not.')
  if (!ok) return
  const sheet = document.querySelector<HTMLElement>('#sheet')
  if (sheet) sheet.hidden = true
  const response = await api<{ credits: number; applied?: string[]; game: GameView | null }>('/api/game/start', {
    difficulty: level,
    player: state.colorChoice,
    theme: state.theme,
    pieceStyle: state.style,
    effect: state.effect,
  })
  state.thinkToken++
  state.mode = 'premium'
  state.human = state.colorChoice
  state.chess.reset()
  state.flipped = state.human === 'b'
  state.selected = null
  state.last = null
  state.note = ''
  if (response.game) {
    state.theme = response.game.theme
    state.style = response.game.pieceStyle
    state.effect = response.game.effect
  }
  renderPlay()
  state.busy = true
  try {
    await revealServer(response.applied ?? [], response.game, response.credits)
  } finally {
    state.busy = false
  }
}

function resume(): void {
  const game = state.pass?.game
  if (!game) return
  state.mode = 'premium'
  state.human = game.player
  state.theme = game.theme
  state.style = game.pieceStyle
  state.effect = game.effect
  state.flipped = game.player === 'b'
  state.selected = null
  state.last = game.lastMove
  state.note = ''
  try {
    state.chess.load(game.fen)
  } catch {
    state.chess.reset()
  }
  renderPlay()
  if (game.result === 'win' || game.result === 'loss' || state.chess.isCheckmate()) showMate(false)
}

async function refreshPremium(): Promise<void> {
  if (!state.pass?.gateEnabled) return
  try {
    const status = await api<PassStatus>('/api/pass/status')
    state.pass = status
    if (state.screen === 'play' && state.mode === 'premium' && status.game?.result && !state.busy) {
      state.last = status.game.lastMove
      updateStatus()
      if (status.game.result === 'timeout') {
        try {
          state.chess.load(status.game.fen)
        } catch {
          /* ignore */
        }
        drawAll()
      }
    }
  } catch {
    /* keep playing locally until the next action */
  }
}

async function onClick(event: Event): Promise<void> {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-promo]')
  if (!target) return
  if (target.closest('#confirm')) return
  const action = target.getAttribute('data-action')
  if (action === 'mute') {
    sfx.toggle()
    paintMute()
    return
  }
  if (action === 'color') {
    state.colorChoice = state.colorChoice === 'w' ? 'b' : 'w'
    if (state.screen === 'menu') renderMenu()
    if (!document.querySelector('#sheet')?.hasAttribute('hidden')) openSheet()
    return
  }
  if (action === 'pass') {
    state.note = ''
    if (premiumLive()) {
      const ok = await confirmBox('A premium game is still running and forfeits after 30 minutes idle. Play a free game anyway?')
      if (!ok) return
    }
    beginPass()
    return
  }
  if (action === 'easy') {
    state.note = ''
    beginEasy()
    return
  }
  if (action === 'open-premium') {
    openSheet((target.dataset.level as PremiumDifficulty | undefined) || undefined)
    return
  }
  if (action === 'close-sheet') {
    const sheet = document.querySelector<HTMLElement>('#sheet')
    if (sheet) sheet.hidden = true
    return
  }
  if (action === 'pick-theme' && target.dataset.theme) {
    state.theme = target.dataset.theme as ThemeId
    openSheet()
    return
  }
  if (action === 'pick-style' && target.dataset.style) {
    state.style = target.dataset.style as PieceStyleId
    openSheet()
    return
  }
  if (action === 'pick-effect' && target.dataset.effect) {
    state.effect = target.dataset.effect as EffectPackId
    openSheet()
    return
  }
  if (action === 'start-premium' && target.dataset.level) {
    try {
      await beginPremium(target.dataset.level as PremiumDifficulty)
    } catch (error) {
      state.note = error instanceof Error ? error.message : 'Could not start.'
      renderMenu()
    }
    return
  }
  if (action === 'resume') {
    resume()
    return
  }
  if (action === 'menu') {
    state.note = ''
    renderMenu()
    return
  }
  if (action === 'flip' && !state.busy) {
    state.flipped = !state.flipped
    buildSquares()
    drawAll()
    return
  }
  if (action === 'undo' && !state.busy) {
    await undo()
    return
  }
  if (action === 'new' && !state.busy) {
    await newGame()
    return
  }
  if (action === 'resign' && !state.busy) {
    await resign()
    return
  }
  if (action === 'live-theme' && state.mode === 'premium' && target.dataset.theme) {
    state.theme = target.dataset.theme as ThemeId
    await pushLook()
    return
  }
  if (action === 'live-style' && state.mode === 'premium' && target.dataset.style) {
    state.style = target.dataset.style as PieceStyleId
    await pushLook()
    return
  }
  if (action === 'live-effect' && state.mode === 'premium' && target.dataset.effect) {
    state.effect = target.dataset.effect as EffectPackId
    await pushLook()
    return
  }
}

async function pushLook(): Promise<void> {
  applyTheme()
  drawPieces()
  renderLook()
  const game = state.pass?.game
  if (!game || game.result) return
  try {
    const response = await api<{ game: GameView | null; credits: number }>('/api/game/look', {
      gameId: game.id,
      theme: state.theme,
      pieceStyle: state.style,
      effect: state.effect,
    })
    if (state.pass) {
      state.pass.game = response.game
      state.pass.credits = response.credits
    }
  } catch (error) {
    state.note = error instanceof Error ? error.message : 'Could not change the look.'
    updateStatus()
  }
}

async function undo(): Promise<void> {
  if (state.mode === 'premium') {
    const game = state.pass?.game
    if (!game) return
    state.busy = true
    try {
      const response = await api<{ game: GameView | null; credits: number }>('/api/game/undo', { gameId: game.id })
      if (state.pass) {
        state.pass.game = response.game
        state.pass.credits = response.credits
      }
      if (response.game) {
        state.chess.load(response.game.fen)
        state.last = response.game.lastMove
      }
      const mate = document.querySelector<HTMLElement>('[data-mate]')
      if (mate) mate.hidden = true
      boardEl()?.classList.remove('celebrating')
      fx?.stopCelebrate()
      drawAll()
    } catch (error) {
      state.note = error instanceof Error ? error.message : 'Nothing to undo.'
      updateStatus()
    } finally {
      state.busy = false
    }
    return
  }
  const verbose = state.chess.history({ verbose: true })
  if (state.mode === 'pass') {
    state.chess.undo()
  } else {
    let index = -1
    for (let i = verbose.length - 1; i >= 0; i--) {
      if (verbose[i].color === state.human) index = i
      if (index >= 0) break
    }
    if (index < 0) return
    for (let i = 0; i < verbose.length - index; i++) state.chess.undo()
  }
  const after = state.chess.history({ verbose: true })
  const last = after[after.length - 1]
  state.last = last ? { from: last.from, to: last.to } : null
  const mate = document.querySelector<HTMLElement>('[data-mate]')
  if (mate) mate.hidden = true
  const board = boardEl()
  board?.classList.remove('celebrating')
  if (board) board.dataset.anim = ''
  drawAll()
}

async function newGame(): Promise<void> {
  if (state.mode === 'premium') {
    const ok = await confirmBox('Resign this premium game? The credit is not refunded. Only a win earns the next game free.')
    if (!ok) return
    await resign()
    return
  }
  if (state.chess.history().length) {
    const ok = await confirmBox('Start a new game?')
    if (!ok) return
  }
  if (state.mode === 'easy') beginEasy()
  else beginPass()
}

async function resign(): Promise<void> {
  const game = state.pass?.game
  if (!game) {
    renderMenu()
    return
  }
  try {
    const response = await api<{ game: GameView | null; credits: number }>('/api/game/resign', { gameId: game.id })
    if (state.pass) {
      state.pass.game = response.game
      state.pass.credits = response.credits
    }
  } catch (error) {
    state.note = error instanceof Error ? error.message : 'Could not resign.'
  }
  state.note = ''
  renderMenu()
}

app.addEventListener('click', (event) => {
  void onClick(event)
})

app.addEventListener('submit', (event) => {
  const form = (event.target as HTMLElement).closest('form[data-action="redeem"]')
  if (!form) return
  event.preventDefault()
  void redeem()
})

async function redeem(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('#license-key')
  const alert = document.querySelector('[data-alert]')
  try {
    const response = await api<{ credits: number }>('/api/pass/unlock', { licenseKey: input?.value ?? '' })
    if (state.pass) state.pass.credits = response.credits
    if (input) input.value = ''
    openSheet()
  } catch (error) {
    if (alert) alert.textContent = error instanceof Error ? error.message : 'Could not redeem that key.'
  }
}

window.addEventListener('resize', () => fx?.resize())
window.setInterval(() => {
  if (state.mode === 'premium') void refreshPremium()
}, 40000)

void boot()

async function boot(): Promise<void> {
  shell()
  try {
    state.pass = await api<PassStatus>('/api/pass/status')
  } catch {
    state.pass = {
      ok: true,
      gateEnabled: false,
      comingSoon: true,
      priceLabel: '$4.99',
      checkoutUrl: '',
      terms: TERMS,
      credits: 0,
      game: null,
    }
  }
  renderMenu()
}

app.addEventListener('pointerdown', () => sfx.unlock(), { once: true })
