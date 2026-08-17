// 00-find-competitions.js
// Découverte automatique des c- de toutes les compétitions FFHB
// pour une saison donnée, via l'API Bright Data Search Engine.
//
// Stratégie :
//   1. Cherche les pages "comité/ligue" sur ffhandball.fr via Google
//   2. Scrape chaque page index pour extraire toutes les compétitions
//   3. Extrait le c- depuis les URLs
//   4. Détecte les compétitions "pending" (pas encore de poule)
//   5. Sauvegarde dans competitions-SAISON.json
//   6. Affiche un rapport : trouvées vs manquantes
//
// Relancer chaque semaine jusqu'à ce que toutes les poules soient sorties.

import dotenv from 'dotenv'
import fs from 'fs'
import https from 'https'

dotenv.config()

// ─── Config ───────────────────────────────────────────────────────────────────
const SAISON        = '2026-2027'
const SAISON_ID     = '22'           // identifiant dans les URLs ffhandball.fr
const SAISON_SLUG   = `saison-${SAISON}-${SAISON_ID}`
const OUTPUT_FILE   = `competitions-${SAISON}.json`
const BRIGHT_DATA_API_KEY = process.env.BRIGHT_DATA_API_KEY
const DELAY_MS      = 1500           // délai entre les requêtes Bright Data

// ─── Comités et ligues à scanner ──────────────────────────────────────────────
// Format : { nom, slug_url, type }
// Le slug_url est l'identifiant dans l'URL ffhandball.fr
const COMITES = [
  // ── Nationales ──
  { nom: 'National',      slug: 'national',      type: 'national'      },

  // ── Ligues régionales (pour N3, R1, R2, R3...) ──
  { nom: 'Île-de-France', slug: 'ligue-ile-de-france', type: 'regional', id: '78' },

  // ── Comités départementaux IDF ──
  { nom: 'Val-de-Marne (94)',    slug: 'comite-du-val-de-marne',    type: 'departemental', id: '124' },
  { nom: 'Val-d\'Oise (95)',     slug: 'comite-du-val-d-oise',      type: 'departemental', id: '125' },
  { nom: 'Seine-Saint-Denis (93)',slug:'comite-de-seine-saint-denis',type: 'departemental', id: '120' },
  { nom: 'Hauts-de-Seine (92)',  slug: 'comite-des-hauts-de-seine', type: 'departemental', id: '116' },
  { nom: 'Essonne (91)',         slug: 'comite-de-l-essonne',       type: 'departemental', id: '113' },
  { nom: 'Yvelines (78)',        slug: 'comite-des-yvelines',       type: 'departemental', id: '109' },
  { nom: 'Seine-et-Marne (77)',  slug: 'comite-de-seine-et-marne',  type: 'departemental', id: '107' },

  // ── Coupes de France ──
  { nom: 'Coupe de France', slug: 'coupe-de-france', type: 'coupe' },
]

// ─── Requête HTTP simple ───────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
      res.on('error', reject)
    }).on('error', reject)
  })
}

// ─── Recherche via Bright Data Search Engine API ──────────────────────────────
async function brightDataSearch(query) {
  await new Promise(r => setTimeout(r, DELAY_MS))

  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=fr`

  const body = JSON.stringify({
    zone: 'serp_api1',
    url: googleUrl,
    format: 'json',
    data_format: 'parsed_light',
  })

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.brightdata.com',
      path: '/request',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          const body = typeof parsed.body === 'string'
            ? JSON.parse(parsed.body)
            : parsed.body
          const urls = (body?.organic || [])
            .map(r => r.link)
            .filter(Boolean)
          resolve({ organic: urls.map(link => ({ link })) })
        } catch (err) {
          console.error('  Parse error:', data.substring(0, 200))
          resolve({ organic: [] })
        }
      })
    })

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ─── Scrape une page ffhandball via Bright Data ───────────────────────────────
async function scrapePageFFHB(url) {
  await new Promise(r => setTimeout(r, DELAY_MS))

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      url,
      format: 'raw',
    })

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }

    const req = https.request('https://api.brightdata.com/request', options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
    })

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ─── Extrait les c- depuis un texte HTML ou liste d'URLs ──────────────────────
function extraireCompetitions(urls, comiteNom, type) {
  const competitions = []
  const pattern = /\/competitions\/saison-[^/]+\/[^/]+\/([^/]+)-(\d{4,6})(?:\/|$)/g

  const seen = new Set()

  for (const url of urls) {
    const matches = [...url.matchAll(pattern)]
    for (const match of matches) {
      const nomSlug = match[1]
      const cId     = match[2]
      const key     = `${cId}`

      if (seen.has(key)) continue
      seen.add(key)

      // Détermine le genre
      const genre = nomSlug.includes('feminine') || nomSlug.includes('feminins')
        ? 'F'
        : nomSlug.includes('masculin') || nomSlug.includes('masculins')
          ? 'M'
          : 'M'

      // Détermine si c'est jeunes
      const jeunes = nomSlug.includes('16-ans') || nomSlug.includes('18-ans')
        || nomSlug.includes('u16') || nomSlug.includes('u18')

      // Nom lisible
      const nomLisible = nomSlug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())
        .trim()

      competitions.push({
        c: cId,
        nom: nomLisible,
        nom_slug: nomSlug,
        genre,
        jeunes,
        lieu: comiteNom,
        type,
        statut: 'found',
        saison: SAISON,
      })
    }
  }

  return competitions
}

// ─── Cherche les compétitions d'un comité via Google ─────────────────────────
async function chercherComite(comite) {
  console.log(`\n→ Scan ${comite.nom}`)

  const toutes = []

  // Stratégie 1 : cherche la page index du comité/ligue
  const queryIndex = comite.id
    ? `site:ffhandball.fr "${SAISON_SLUG}" "departemental" "${comite.slug}"`
    : `site:ffhandball.fr "${SAISON_SLUG}" "${comite.type}" "${comite.slug.replace(/-/g, ' ')}"`

  console.log(`  Recherche : ${queryIndex}`)

  const results = await brightDataSearch(queryIndex)
  const urls = (results?.organic || []).map(r => r.link).filter(Boolean)

  console.log(`  ${urls.length} URLs trouvées`)

  const competitions = extraireCompetitions(urls, comite.nom, comite.type)

  for (const comp of competitions) {
    console.log(`  ✓ c-${comp.c} — ${comp.nom} ${comp.genre}${comp.jeunes ? ' (jeunes)' : ''}`)
    toutes.push(comp)
  }

  // Stratégie 2 : si c'est national, cherche aussi les coupes
  if (comite.type === 'national') {
    const queryNational = `site:ffhandball.fr "${SAISON_SLUG}/national/" calendrier`
    const resNational = await brightDataSearch(queryNational)
    const urlsNational = (resNational?.organic || []).map(r => r.link).filter(Boolean)
    const compNational = extraireCompetitions(urlsNational, 'France', 'national')

    for (const comp of compNational) {
      if (!toutes.find(c => c.c === comp.c)) {
        console.log(`  ✓ c-${comp.c} — ${comp.nom} ${comp.genre}`)
        toutes.push(comp)
      }
    }
  }

  return toutes
}

// ─── Cherche spécifiquement les coupes de France ──────────────────────────────
async function chercherCoupes() {
  console.log('\n→ Scan Coupes de France')
  const toutes = []

  const queries = [
    `site:ffhandball.fr "${SAISON_SLUG}/coupe-de-france/" calendrier`,
    `site:ffhandball.fr "${SAISON_SLUG}" "coupe-de-france-federale"`,
    `site:ffhandball.fr "${SAISON_SLUG}" "coupe-de-france" "professionnelle"`,
    `site:ffhandball.fr "${SAISON_SLUG}" "trophee-des-champions"`,
  ]

  for (const query of queries) {
    const results = await brightDataSearch(query)
    const urls = (results?.organic || []).map(r => r.link).filter(Boolean)
    const competitions = extraireCompetitions(urls, 'France', 'coupe')

    for (const comp of competitions) {
      if (!toutes.find(c => c.c === comp.c)) {
        console.log(`  ✓ c-${comp.c} — ${comp.nom} ${comp.genre}`)
        toutes.push(comp)
      }
    }

    await new Promise(r => setTimeout(r, DELAY_MS))
  }

  // Ajouter les c- déjà connus manuellement (récupérés précédemment)
  const connus = [
    { c: '32473', nom: 'Trophée des Champions', genre: 'M', lieu: 'France', type: 'coupe', jeunes: false, saison: SAISON, statut: 'found' },
    { c: '30617', nom: 'Coupe de France Professionnelle', genre: 'M', lieu: 'France', type: 'coupe', jeunes: false, saison: SAISON, statut: 'found' },
    { c: '32510', nom: 'Coupe de France Fédérale', genre: 'M', lieu: 'France', type: 'coupe', jeunes: false, saison: SAISON, statut: 'found' },
    { c: '32636', nom: 'Coupe de France Professionnelle', genre: 'F', lieu: 'France', type: 'coupe', jeunes: false, saison: SAISON, statut: 'found' },
    { c: '32638', nom: 'Coupe de France Fédérale', genre: 'F', lieu: 'France', type: 'coupe', jeunes: false, saison: SAISON, statut: 'found' },
  ]

  for (const comp of connus) {
    if (!toutes.find(c => c.c === comp.c)) {
      toutes.push(comp)
    }
  }

  return toutes
}

// ─── Charge le fichier existant (pour ne pas écraser les données) ─────────────
function chargerExistant() {
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'))
    } catch {
      return []
    }
  }
  return []
}

// ─── Fusionne les nouvelles compétitions avec les existantes ──────────────────
function fusionner(existantes, nouvelles) {
  const map = new Map(existantes.map(c => [c.c, c]))

  for (const comp of nouvelles) {
    if (!map.has(comp.c)) {
      map.set(comp.c, comp)
      console.log(`  + Nouveau : c-${comp.c} — ${comp.nom} ${comp.genre} (${comp.lieu})`)
    }
  }

  return [...map.values()]
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`DÉCOUVERTE COMPÉTITIONS FFHB — Saison ${SAISON}`)
  console.log('═'.repeat(60))

  if (!BRIGHT_DATA_API_KEY) {
    console.error('❌ BRIGHT_DATA_API_KEY manquant dans .env')
    console.error('   Ajoute : BRIGHT_DATA_API_KEY=ta_clé_ici')
    process.exit(1)
  }

  // Charger les données existantes
  const existantes = chargerExistant()
  console.log(`\n${existantes.length} compétitions déjà en fichier`)

  const toutes = [...existantes]

  // Scanner tous les comités
  for (const comite of COMITES) {
    if (comite.type === 'coupe') continue // géré séparément

    try {
      const competitions = await chercherComite(comite)
      const nouvelles = fusionner(toutes, competitions)
        .filter(c => !toutes.find(t => t.c === c.c))

      toutes.push(...nouvelles)
    } catch (err) {
      console.error(`  ✗ Erreur pour ${comite.nom}:`, err.message)
    }
  }

  // Scanner les coupes
  try {
    const coupes = await chercherCoupes()
    for (const comp of coupes) {
      if (!toutes.find(c => c.c === comp.c)) {
        toutes.push(comp)
      }
    }
  } catch (err) {
    console.error('  ✗ Erreur coupes:', err.message)
  }

  // Sauvegarder
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(toutes, null, 2))
  console.log(`\n✓ Fichier sauvegardé : ${OUTPUT_FILE}`)

  // ─── Rapport final ──────────────────────────────────────────────────────────
  const parType = {}
  for (const comp of toutes) {
    parType[comp.type] = (parType[comp.type] || 0) + 1
  }

  const seniors = toutes.filter(c => !c.jeunes)
  const jeunes  = toutes.filter(c => c.jeunes)
  const masculin = toutes.filter(c => c.genre === 'M')
  const feminin  = toutes.filter(c => c.genre === 'F')

  console.log(`\n${'─'.repeat(60)}`)
  console.log('RAPPORT')
  console.log('─'.repeat(60))
  console.log(`Total compétitions trouvées : ${toutes.length}`)
  console.log(`  Seniors   : ${seniors.length}`)
  console.log(`  Jeunes    : ${jeunes.length}`)
  console.log(`  Masculin  : ${masculin.length}`)
  console.log(`  Féminin   : ${feminin.length}`)
  console.log()
  for (const [type, nb] of Object.entries(parType)) {
    console.log(`  ${type.padEnd(15)} : ${nb}`)
  }
  console.log('─'.repeat(60))
  console.log(`\nProchain lancement recommandé : dans 7 jours`)
  console.log(`→ node scripts/00-find-competitions.js`)
  console.log(`\nPuis lancer le scan des équipes :`)
  console.log(`→ node scripts/02-discover-teams.js`)
}

run()
