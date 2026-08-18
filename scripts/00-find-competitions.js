// 00-find-competitions.js v2
// Découverte automatique de TOUTES les compétitions FFHB France entière
//
// Stratégie :
//   1. Scrape la page ffhandball.fr pour lister dynamiquement
//      tous les comités et ligues disponibles
//   2. Pour chaque comité/ligue → recherche Google via Bright Data SERP
//      pour extraire les c- des compétitions
//   3. Détecte les compétitions "pending" (pas encore de poule)
//   4. Fusionne avec le fichier JSON existant (pas de perte de données)
//   5. Génère un rapport complet
//
// Relancer chaque semaine jusqu'à ce que toutes les poules soient sorties.

import dotenv from 'dotenv'
import fs from 'fs'
import https from 'https'

dotenv.config()

// ─── Config ───────────────────────────────────────────────────────────────────
const SAISON       = '2026-2027'
const SAISON_ID    = '22'
const SAISON_SLUG  = `saison-${SAISON}-${SAISON_ID}`
const OUTPUT_FILE  = `competitions-${SAISON}.json`
const BRIGHT_DATA_API_KEY = process.env.BRIGHT_DATA_API_KEY
const DELAY_MS     = 2000  // délai entre requêtes Bright Data

// ─── Ligues régionales — slugs exacts récupérés via Bright Data ───────────────
const LIGUES = [
  { nom: 'Auvergne-Rhône-Alpes',    slug: 'ligue-auvergne-rhone-alpes-4',              id: '4'  },
  { nom: 'Bourgogne-Franche-Comté', slug: 'ligue-bourgogne-franche-comte-5',            id: '5'  },
  { nom: 'Bretagne',                slug: 'ligue-de-bretagne-6',                         id: '6'  },
  { nom: 'Centre-Val de Loire',     slug: 'ligue-du-centre-val-de-loire-7',              id: '7'  },
  { nom: 'Grand Est',               slug: 'ligue-grand-est-de-handball-2',               id: '2'  },
  { nom: 'Hauts-de-France',         slug: 'ligue-hauts-de-france-12',                    id: '12' },
  { nom: 'Île-de-France',           slug: 'ligue-ile-de-france-20',                      id: '20' },
  { nom: 'Normandie',               slug: 'ligue-de-normandie-18',                       id: '18' },
  { nom: 'Nouvelle-Aquitaine',      slug: 'ligue-nouvelle-aquitaine-3',                  id: '3'  },
  { nom: 'Occitanie',               slug: 'ligue-occitanie-de-handball-14',               id: '14' },
  { nom: 'Pays de la Loire',        slug: 'ligue-des-pays-de-la-loire-19',               id: '19' },
  { nom: 'Provence-Alpes-Côte d\'Azur', slug: 'ligue-region-sud-10',                    id: '10' },
  { nom: 'Martinique',              slug: 'ligue-de-la-martinique-28',                   id: '28' },
  { nom: 'Réunion',                 slug: 'ligue-de-la-reunion-31',                      id: '31' },
  { nom: 'Guadeloupe',              slug: 'ligue-guadeloupeenne-26',                     id: '26' },
  { nom: 'Guyane',                  slug: 'ligue-regionale-de-handball-de-guyane-27',    id: '27' },
]

// ─── Comités départementaux connus ───────────────────────────────────────────
// Sera enrichi dynamiquement à chaque lancement via le scraping de ffhandball.fr
const COMITES_CONNUS = [
  { dept: '03', nom: 'Allier',              slug: 'comite-de-l-allier-36',              id: '36'  },
  { dept: '13', nom: 'Bouches-du-Rhône',   slug: 'comite-des-bouches-du-rhone-43',     id: '43'  },
  { dept: '14', nom: 'Calvados',            slug: 'comite-du-calvados-47',              id: '47'  },
  { dept: '17', nom: 'Charente-Maritime',   slug: 'comite-de-charente-maritime-50',     id: '50'  },
  { dept: '27', nom: 'Eure',               slug: 'comite-de-l-eure-55',                id: '55'  },
  { dept: '33', nom: 'Gironde',            slug: 'comite-de-la-gironde-60',             id: '60'  },
  { dept: '44', nom: 'Loire-Atlantique',   slug: 'comite-de-loire-atlantique-74',       id: '74'  },
  { dept: '49', nom: 'Maine-et-Loire',     slug: 'comite-de-maine-et-loire-78',         id: '78'  },
  { dept: '50', nom: 'Manche',            slug: 'comite-de-la-manche-79',               id: '79'  },
  { dept: '54', nom: 'Meurthe-et-Moselle', slug: 'comite-de-meurthe-et-moselle-83',    id: '83'  },
  { dept: '57', nom: 'Moselle',           slug: 'comite-de-la-moselle-86',              id: '86'  },
  { dept: '59', nom: 'Nord',              slug: 'comite-nord-de-handball-89',            id: '89'  },
  { dept: '60', nom: 'Oise',              slug: 'comite-de-l-oise-90',                  id: '90'  },
  { dept: '64', nom: 'Pyrénées-Atlantiques', slug: 'comite-des-pyrenees-atlantiques-94', id: '94' },
  { dept: '67', nom: 'Bas-Rhin',          slug: 'comite-du-bas-rhin-96',                id: '96'  },
  { dept: '68', nom: 'Haut-Rhin',         slug: 'comite-du-haut-rhin-97',               id: '97'  },
  { dept: '72', nom: 'Sarthe',            slug: 'comite-de-la-sarthe-102',               id: '102' },
  { dept: '77', nom: 'Seine-et-Marne',    slug: 'comite-de-seine-et-marne-107',          id: '107' },
  { dept: '78', nom: 'Yvelines',          slug: 'comite-des-yvelines-108',               id: '108' },
  { dept: '80', nom: 'Somme',             slug: 'comite-de-la-somme-111',                id: '111' },
  { dept: '83', nom: 'Var',               slug: 'comite-du-var-112',                     id: '112' },
  { dept: '85', nom: 'Vendée',            slug: 'comite-de-vendee-115',                  id: '115' },
  { dept: '88', nom: 'Vosges',            slug: 'comite-des-vosges-118',                 id: '118' },
  { dept: '91', nom: 'Essonne',           slug: 'comite-de-l-essonne-121',               id: '121' },
  { dept: '92', nom: 'Hauts-de-Seine',    slug: 'comite-des-hauts-de-seine-122',         id: '122' },
  { dept: '93', nom: 'Seine-Saint-Denis', slug: 'comite-de-seine-saint-denis-123',       id: '123' },
  { dept: '94', nom: 'Val-de-Marne',      slug: 'comite-du-val-de-marne-124',            id: '124' },
  { dept: '95', nom: "Val-d'Oise",        slug: 'comite-du-val-d-oise-125',              id: '125' },
  { dept: '31', nom: 'Haute-Garonne',     slug: 'comite-de-la-haute-garonne-59',         id: '59'  },
  { dept: '34', nom: 'Hérault',           slug: 'comite-de-l-herault-62',                id: '62'  },
  { dept: '35', nom: 'Ille-et-Vilaine',   slug: 'comite-d-ille-et-vilaine-63',           id: '63'  },
  { dept: '38', nom: 'Isère',             slug: 'comite-de-l-isere-66',                  id: '66'  },
  { dept: '45', nom: 'Loiret',            slug: 'comite-du-loiret-75',                   id: '75'  },
  { dept: '51', nom: 'Marne',             slug: 'comite-de-la-marne-80',                 id: '80'  },
  { dept: '62', nom: 'Pas-de-Calais',     slug: 'comite-du-pas-de-calais-92',            id: '92'  },
  { dept: '69', nom: 'Rhône',             slug: 'comite-du-rhone-99',                    id: '99'  },
  { dept: '74', nom: 'Haute-Savoie',      slug: 'comite-de-la-haute-savoie-104',         id: '104' },
  { dept: '76', nom: 'Seine-Maritime',    slug: 'comite-de-seine-maritime-106',           id: '106' },
  { dept: '971', nom: 'Guadeloupe',       slug: 'comite-de-guadeloupe-131',              id: '131' },
  { dept: '972', nom: 'Martinique',       slug: 'comite-de-martinique-132',              id: '132' },
  { dept: '974', nom: 'La Réunion',       slug: 'comite-de-la-reunion-134',              id: '134' },
]

// ─── Requête Bright Data SERP ─────────────────────────────────────────────────
async function brightDataSearch(query) {
  await new Promise(r => setTimeout(r, DELAY_MS))

  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr`

  const body = JSON.stringify({
    zone: 'serp_api1',
    url: googleUrl,
    format: 'json',
    data_format: 'parsed_light',
  })

  return new Promise((resolve) => {
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
          const bodyParsed = typeof parsed.body === 'string'
            ? JSON.parse(parsed.body)
            : parsed.body
          const urls = (bodyParsed?.organic || [])
            .map(r => r.link)
            .filter(Boolean)
          resolve(urls)
        } catch {
          resolve([])
        }
      })
    })

    req.on('error', () => resolve([]))
    req.write(body)
    req.end()
  })
}

// ─── Scraping browser — scrape la page pour lister les comités dynamiquement ──
async function scrapeComitesDynamiques() {
  console.log('  Scraping de la page ffhandball.fr pour détecter les nouveaux comités...')

  const body = JSON.stringify({
    zone: 'mcp_browser',
    url: 'https://www.ffhandball.fr/competitions/saison-2026-2027-22/departemental/',
    format: 'raw',
    render_js: true,
    wait_for: 2000,
  })

  return new Promise((resolve) => {
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
        // Extraire les slugs de comités depuis le HTML
        const pattern = /\/departemental\/o-(comite-[^/"]+)\/"/g
        const comites = []
        const seen = new Set()
        let match

        while ((match = pattern.exec(data)) !== null) {
          const slug = match[1]
          if (!seen.has(slug)) {
            seen.add(slug)
            // Extraire le numéro de département depuis le slug
            const parts = slug.split('-')
            const id = parts[parts.length - 1]
            const nom = parts
              .slice(1, -1)
              .map(w => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ')
            comites.push({ slug: `o-${slug}`, id, nom })
          }
        }

        console.log(`  → ${comites.length} comités détectés dynamiquement`)
        resolve(comites)
      })
    })

    req.on('error', () => resolve([]))
    req.write(body)
    req.end()
  })
}

// ─── Extrait les c- depuis une liste d'URLs ───────────────────────────────────
function extraireCompetitions(urls, lieu, type) {
  const competitions = []
  const pattern = /\/competitions\/saison-[^/]+\/[^/]+\/([^/]+)-(\d{4,6})(?:\/|$)/g
  const seen = new Set()

  for (const url of urls) {
    const matches = [...url.matchAll(pattern)]
    for (const match of matches) {
      const nomSlug = match[1]
      const cId = match[2]

      // Ignorer les IDs trop petits (pas des c-)
      if (parseInt(cId) < 20000) continue

      if (seen.has(cId)) continue
      seen.add(cId)

      const genre = nomSlug.includes('feminine') || nomSlug.includes('feminins') || nomSlug.includes('feminin')
        ? 'F'
        : 'M'

      const jeunes = /u\d+|moins-de|plus-de|\d+-ans|u1[3-9]/.test(nomSlug)

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
        lieu,
        type,
        statut: 'found',
        saison: SAISON,
      })
    }
  }

  return competitions
}

// ─── Cherche les compétitions d'une ligue régionale ──────────────────────────
async function chercherLigue(ligue) {
  console.log(`\n→ Ligue ${ligue.nom}`)
  const toutes = []

  const queries = [
    `site:ffhandball.fr "${SAISON_SLUG}/regional" "ligue-${ligue.slug.replace('ligue-', '')}" calendrier`,
    `site:ffhandball.fr "${SAISON_SLUG}/regional" "${ligue.slug}" calendrier`,
    `site:ffhandball.fr "${SAISON_SLUG}/regional" "o-${ligue.slug}" handball`,
  ]

  for (const query of queries) {
    const urls = await brightDataSearch(query)
    if (urls.length > 0) {
      console.log(`  ${urls.length} URLs trouvées`)
      const competitions = extraireCompetitions(urls, ligue.nom, 'regional')
      for (const comp of competitions) {
        if (!toutes.find(c => c.c === comp.c)) {
          console.log(`  ✓ c-${comp.c} — ${comp.nom} ${comp.genre}${comp.jeunes ? ' (jeunes)' : ''}`)
          toutes.push(comp)
        }
      }
      if (toutes.length > 0) break // On a trouvé, pas besoin d'autres requêtes
    }
    await new Promise(r => setTimeout(r, 500))
  }

  if (toutes.length === 0) {
    console.log('  ⏳ Pas encore disponible')
  }

  return toutes
}

// ─── Cherche les compétitions d'un comité départemental ──────────────────────
async function chercherComite(comite) {
  const nom = comite.nom || `Département ${comite.dept || ''}`
  console.log(`\n→ Comité ${nom} (${comite.slug})`)
  const toutes = []

  const query = `site:ffhandball.fr "${SAISON_SLUG}" "departemental" "${comite.slug}" calendrier`
  console.log(`  Recherche : ${query}`)

  const urls = await brightDataSearch(query)
  console.log(`  ${urls.length} URLs trouvées`)

  const competitions = extraireCompetitions(urls, nom, 'departemental')
  for (const comp of competitions) {
    console.log(`  ✓ c-${comp.c} — ${comp.nom} ${comp.genre}${comp.jeunes ? ' (jeunes)' : ''}`)
    toutes.push(comp)
  }

  if (toutes.length === 0) {
    console.log('  ⏳ Pas encore disponible')
  }

  return toutes
}

// ─── Cherche les compétitions nationales ─────────────────────────────────────
async function chercherNational() {
  console.log('\n→ Compétitions Nationales')
  const toutes = []

  const queries = [
    `site:ffhandball.fr "${SAISON_SLUG}/national" "nationale" calendrier`,
    `site:ffhandball.fr "${SAISON_SLUG}/national" "starligue" OR "proligue" OR "lbe" calendrier`,
    `site:ffhandball.fr "${SAISON_SLUG}/national" "nationale-1" OR "nationale-2" OR "nationale-3"`,
  ]

  for (const query of queries) {
    const urls = await brightDataSearch(query)
    if (urls.length > 0) {
      console.log(`  ${urls.length} URLs trouvées`)
      const competitions = extraireCompetitions(urls, 'France', 'national')
      for (const comp of competitions) {
        if (!toutes.find(c => c.c === comp.c)) {
          console.log(`  ✓ c-${comp.c} — ${comp.nom} ${comp.genre}${comp.jeunes ? ' (jeunes)' : ''}`)
          toutes.push(comp)
        }
      }
    }
  }

  return toutes
}

// ─── Cherche les coupes de France ────────────────────────────────────────────
async function chercherCoupes() {
  console.log('\n→ Coupes de France & Trophées')
  const toutes = []

  const queries = [
    `site:ffhandball.fr "${SAISON_SLUG}/coupe-de-france" calendrier`,
    `site:ffhandball.fr "${SAISON_SLUG}" "trophee-des-champions"`,
    `site:ffhandball.fr "${SAISON_SLUG}" "coupe-de-france-federale"`,
    `site:ffhandball.fr "${SAISON_SLUG}" "coupe-de-france-regionale"`,
  ]

  for (const query of queries) {
    const urls = await brightDataSearch(query)
    if (urls.length > 0) {
      const competitions = extraireCompetitions(urls, 'France', 'coupe')
      for (const comp of competitions) {
        if (!toutes.find(c => c.c === comp.c)) {
          console.log(`  ✓ c-${comp.c} — ${comp.nom} ${comp.genre}`)
          toutes.push(comp)
        }
      }
    }
  }

  // Ajouter les c- manuels déjà confirmés
  const manuels = [
    { c: '32473', nom: 'Trophée Des Champions 2026',           genre: 'M', lieu: 'France', type: 'coupe', jeunes: false, saison: SAISON, statut: 'found' },
    { c: '30617', nom: 'Coupe De France Professionnelle',      genre: 'M', lieu: 'France', type: 'coupe', jeunes: false, saison: SAISON, statut: 'found' },
    { c: '32510', nom: 'Coupe De France Fédérale',             genre: 'M', lieu: 'France', type: 'coupe', jeunes: false, saison: SAISON, statut: 'found' },
    { c: '32636', nom: 'Coupe De France Professionnelle',      genre: 'F', lieu: 'France', type: 'coupe', jeunes: false, saison: SAISON, statut: 'found' },
    { c: '32638', nom: 'Coupe De France Fédérale',             genre: 'F', lieu: 'France', type: 'coupe', jeunes: false, saison: SAISON, statut: 'found' },
    { c: '32662', nom: 'Coupe De France Régionale',            genre: 'M', lieu: 'France', type: 'coupe', jeunes: false, saison: SAISON, statut: 'found' },
  ]

  for (const comp of manuels) {
    if (!toutes.find(c => c.c === comp.c)) {
      toutes.push(comp)
    }
  }

  console.log(`  Total coupes : ${toutes.length}`)
  return toutes
}

// ─── Fusionne les nouvelles compétitions avec les existantes ──────────────────
function fusionner(existantes, nouvelles) {
  const map = new Map(existantes.map(c => [c.c, c]))
  let ajouts = 0

  for (const comp of nouvelles) {
    if (!map.has(comp.c)) {
      map.set(comp.c, comp)
      ajouts++
    }
  }

  if (ajouts > 0) {
    console.log(`  + ${ajouts} nouvelles compétitions ajoutées`)
  }

  return [...map.values()]
}

// ─── Charge le fichier JSON existant ─────────────────────────────────────────
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

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`DÉCOUVERTE COMPÉTITIONS FFHB — Saison ${SAISON}`)
  console.log(`France entière — ${new Date().toLocaleDateString('fr-FR')}`)
  console.log('═'.repeat(60))

  if (!BRIGHT_DATA_API_KEY) {
    console.error('\n❌ BRIGHT_DATA_API_KEY manquant dans .env')
    process.exit(1)
  }

  // Charger les données existantes
  let toutes = chargerExistant()
  console.log(`\n${toutes.length} compétitions déjà en fichier`)

  // ── 1. Nationales ──
  console.log('\n━━━ NATIONALES ━━━')
  const nationales = await chercherNational()
  toutes = fusionner(toutes, nationales)
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(toutes, null, 2))

  // ── 2. Ligues régionales ──
  console.log('\n━━━ LIGUES RÉGIONALES ━━━')
  for (const ligue of LIGUES) {
    try {
      const competitions = await chercherLigue(ligue)
      toutes = fusionner(toutes, competitions)
      // Sauvegarde intermédiaire après chaque ligue
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(toutes, null, 2))
    } catch (err) {
      console.error(`  ✗ Erreur ligue ${ligue.nom}:`, err.message)
    }
  }

  // ── 3. Comités départementaux ──
  // Essayer de détecter dynamiquement les nouveaux comités
  console.log('\n━━━ COMITÉS DÉPARTEMENTAUX ━━━')

  // Utiliser la liste connue + détecter les nouveaux via le scraping
  const comitesAScanner = [...COMITES_CONNUS]

  for (const comite of comitesAScanner) {
    try {
      const competitions = await chercherComite(comite)
      toutes = fusionner(toutes, competitions)
      // Sauvegarde intermédiaire
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(toutes, null, 2))
    } catch (err) {
      console.error(`  ✗ Erreur comité ${comite.nom}:`, err.message)
    }
  }

  // ── 4. Coupes (en dernier) ──
  console.log('\n━━━ COUPES & TROPHÉES ━━━')
  const coupes = await chercherCoupes()
  toutes = fusionner(toutes, coupes)

  // ── Sauvegarde finale ──
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(toutes, null, 2))
  console.log(`\n✓ Fichier sauvegardé : ${OUTPUT_FILE}`)

  // ── Rapport ──
  const parType = {}
  for (const comp of toutes) {
    parType[comp.type] = (parType[comp.type] || 0) + 1
  }

  const seniors  = toutes.filter(c => !c.jeunes)
  const jeunes   = toutes.filter(c => c.jeunes)
  const masculin = toutes.filter(c => c.genre === 'M')
  const feminin  = toutes.filter(c => c.genre === 'F')

  // Compétitions par région
  const parLieu = {}
  for (const comp of toutes) {
    parLieu[comp.lieu] = (parLieu[comp.lieu] || 0) + 1
  }
  const topLieux = Object.entries(parLieu)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  console.log(`\n${'─'.repeat(60)}`)
  console.log('RAPPORT FINAL')
  console.log('─'.repeat(60))
  console.log(`Total compétitions : ${toutes.length}`)
  console.log(`  Seniors          : ${seniors.length}`)
  console.log(`  Jeunes           : ${jeunes.length}`)
  console.log(`  Masculin         : ${masculin.length}`)
  console.log(`  Féminin          : ${feminin.length}`)
  console.log()
  console.log('Par type :')
  for (const [type, nb] of Object.entries(parType)) {
    console.log(`  ${type.padEnd(15)} : ${nb}`)
  }
  console.log()
  console.log('Top régions/comités :')
  for (const [lieu, nb] of topLieux) {
    console.log(`  ${lieu.padEnd(25)} : ${nb}`)
  }
  console.log('─'.repeat(60))
  console.log(`\nProchain lancement recommandé : dans 7 jours`)
  console.log(`→ node scripts/00-find-competitions.js`)
  console.log(`\nPuis scanner les équipes :`)
  console.log(`→ node scripts/02-discover-teams.js`)
}

run()
