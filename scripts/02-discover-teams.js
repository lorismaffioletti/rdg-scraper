// 02-discover-teams.js v3
// Découverte intelligente des équipes FFHB — Saison 2026-2027
//
// Stratégie en 2 étapes :
//
// ÉTAPE 1 — s- connus × nouveaux c- (ciblé par niveau)
//   → Récupère tous les s- connus en base (club_team_ids)
//   → Pour chaque s-, teste les nouveaux c- du même niveau ±1
//   → Couvre 90-95% des équipes existantes (montées/descentes incluses)
//
// ÉTAPE 2 — Scan nouveaux clubs (IDs > max s- connu)
//   → Uniquement sur les c- de type "departemental"
//   → Car les nouveaux clubs démarrent toujours au niveau départemental
//   → Arrêt anticipé agressif

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import ical from 'node-ical'
import fs from 'fs'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ─── Config ───────────────────────────────────────────────────────────────────
const SAISON       = '2026-2027'
const JSON_FILE    = `competitions-${SAISON}.json`
const BASE_URL     = 'https://competition-calendar.ffhandball.fr'
const DELAY_MS     = 200
const ARRET_APRES  = 300  // IDs vides consécutifs avant arrêt

// Hiérarchie des niveaux — pour tester ±1 niveau
const HIERARCHIE = {
  'professionnel': ['professionnel', 'national'],
  'national':      ['professionnel', 'national', 'regional'],
  'regional':      ['national', 'regional', 'departemental'],
  'departemental': ['regional', 'departemental'],
  'coupe':         ['professionnel', 'national', 'regional', 'departemental'],
  'ehf':           ['professionnel', 'national'],
  'tv':            ['professionnel', 'national'],
}

// ─── Abréviations ─────────────────────────────────────────────────────────────
const ABREVIATIONS = {
  ' HB ':  ' HANDBALL ',
  ' HBA ': ' HANDBALL ',
  ' HBC ': ' HANDBALL CLUB ',
  ' ENT.': ' ENTENTE',
  ' US ':  ' UNION SPORTIVE ',
  ' AS ':  ' ASSOCIATION SPORTIVE ',
  ' AC ':  ' ATHLETIC CLUB ',
  ' SHB ': ' SPORT HANDBALL ',
  'HB$':   'HANDBALL',
}

// ─── Normalisation ────────────────────────────────────────────────────────────
function normaliser(texte) {
  if (!texte) return ''
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function nettoyerNom(nom) {
  let n = nom
    .replace(/\s*\+\d+[MF]?\d*\s*/gi, '')
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/\s+\d+[A-Z]$/i, '')
    .replace(/\s+[A-Z]$/i, '')
    .replace(/\s+\d+$/i, '')
    .trim()

  let maj = ' ' + n.toUpperCase() + ' '
  for (const [abrev, complet] of Object.entries(ABREVIATIONS)) {
    maj = maj.replaceAll(abrev, complet)
  }
  return maj.trim()
}

// ─── Probe une équipe ─────────────────────────────────────────────────────────
async function probeTeam(c, s) {
  const url = `${BASE_URL}/c-${c}/s-${s}.ics`
  try {
    const events = await ical.async.fromURL(url)
    const matchs = Object.values(events).filter(e => e.type === 'VEVENT')
    if (matchs.length === 0) return null

    const comptage = {}
    for (const match of matchs) {
      const nom = match.summary?.split(' vs ')[0]?.trim()
      if (nom) comptage[nom] = (comptage[nom] || 0) + 1
    }

    const teamName = Object.entries(comptage)
      .sort((a, b) => b[1] - a[1])[0]?.[0]
      || `Équipe s-${s}`

    return { teamName, nbMatchs: matchs.length }
  } catch {
    return null
  }
}

// ─── Matching club en base ────────────────────────────────────────────────────
async function matcherClub(teamName) {
  const nomNettoye = nettoyerNom(teamName)
  const nomsATester = [...new Set([teamName, nomNettoye])]

  for (const nom of nomsATester) {
    const nomNorm = normaliser(nom)

    const { data: exact } = await supabase
      .from('clubs')
      .select('id, nom, nom_normalise')
      .eq('nom_normalise', nomNorm)
      .single()
    if (exact) return { club: exact, confiance: 'exact' }

    const { data: partiel } = await supabase
      .from('clubs')
      .select('id, nom, nom_normalise')
      .ilike('nom_normalise', `%${nomNorm}%`)
      .limit(1)
      .single()
    if (partiel) return { club: partiel, confiance: 'partiel' }
  }

  // Mots en commun ≥ 60%
  const mots = normaliser(nettoyerNom(teamName))
    .split(' ').filter(m => m.length > 3)

  if (mots.length > 0) {
    const { data: candidats } = await supabase
      .from('clubs')
      .select('id, nom, nom_normalise')
      .ilike('nom_normalise', `%${mots[0]}%`)
      .limit(10)

    if (candidats) {
      let meilleur = null, meilleurScore = 0
      for (const c of candidats) {
        const motsC = c.nom_normalise.split(' ').filter(m => m.length > 3)
        const communs = mots.filter(m => motsC.includes(m))
        const score = communs.length / mots.length
        if (score > meilleurScore && score >= 0.6 && communs.length >= 2) {
          meilleurScore = score
          meilleur = c
        }
      }
      if (meilleur) return { club: meilleur, confiance: 'partiel' }
    }
  }

  return { club: null, confiance: 'aucun' }
}

// ─── Sauvegarder une équipe trouvée en base ───────────────────────────────────
async function sauvegarderEquipe(s, teamName, competitionId, competitionC, clubId, confiance) {
  if (confiance !== 'exact') return

  await supabase
    .from('club_team_ids')
    .upsert({
      club_id: clubId,
      competition_id: competitionId,
      ffhb_team_id: String(s),
      ffhb_competition_id: competitionC,
    }, { onConflict: 'ffhb_team_id,ffhb_competition_id' })

  try {
    await supabase
      .from('club_name_aliases')
      .upsert({
        club_id: clubId,
        alias: teamName,
        alias_normalise: normaliser(teamName),
        source: 'auto_exact',
      }, { onConflict: 'alias' })
  } catch {}
}

// ─── Upsert compétition ───────────────────────────────────────────────────────
async function upsertCompetition(comp) {
  const nom = comp.nom
    .replace(/\b\w/g, l => l.toUpperCase())
    .trim()

  const { data, error } = await supabase
    .from('competitions')
    .upsert({
      ffhb_competition_id: comp.c,
      nom,
      region: comp.lieu || 'France',
      saison: SAISON,
      niveau: comp.type || null,
    }, { onConflict: 'ffhb_competition_id' })
    .select('id')
    .single()

  if (error) {
    console.error(`  ✗ Erreur compétition c-${comp.c}: ${error.message}`)
    return null
  }
  return data.id
}

// ─── ÉTAPE 1 — Tester les s- connus avec les nouveaux c- ─────────────────────
async function etape1(equipesConnues, nouvellesCompetitions) {
  console.log('\n━━━ ÉTAPE 1 — s- connus × nouveaux c- ━━━')
  console.log(`${equipesConnues.length} équipes connues × ${nouvellesCompetitions.length} nouvelles compétitions\n`)

  const resultats = []
  let nbTestes = 0, nbTrouves = 0

  for (const equipe of equipesConnues) {
    const { ffhb_team_id: s, niveau_ancien } = equipe

    // Déterminer les niveaux à tester pour ce s-
    const niveauxATester = HIERARCHIE[niveau_ancien] || [niveau_ancien]

    // Filtrer les nouvelles compétitions pertinentes
    const competitionsATester = nouvellesCompetitions.filter(c =>
      niveauxATester.includes(c.type)
    )

    process.stdout.write(`  s-${s} (${niveau_ancien}) → `)

    for (const comp of competitionsATester) {
      const result = await probeTeam(comp.c, s)
      nbTestes++

      if (result) {
        const competitionId = await upsertCompetition(comp)
        if (!competitionId) continue

        const { club, confiance } = await matcherClub(result.teamName)

        resultats.push({
          s,
          teamName: result.teamName,
          competitionC: comp.c,
          competitionId,
          competitionNom: comp.nom,
          clubId: club?.id || null,
          clubNom: club?.nom || null,
          confiance,
        })

        if (club && confiance === 'exact') {
          await sauvegarderEquipe(s, result.teamName, competitionId, comp.c, club.id, confiance)
        }

        process.stdout.write(` ✓ ${comp.nom}\n`)
        nbTrouves++
      }

      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }

  console.log(`\n  Testés: ${nbTestes} | Trouvés: ${nbTrouves}`)
  return resultats
}

// ─── ÉTAPE 2 — Scan nouveaux clubs (IDs > max s- connu) ──────────────────────
async function etape2(maxSConnu, nouvellesCompetitions, aValider) {
  console.log(`\n━━━ ÉTAPE 2 — Nouveaux clubs (s- > ${maxSConnu}) ━━━`)

  // Uniquement les compétitions départementales
  // Car les nouveaux clubs démarrent toujours au niveau départemental
  const compsDepartementales = nouvellesCompetitions.filter(c => c.type === 'departemental')
  console.log(`${compsDepartementales.length} compétitions départementales à scanner\n`)

  for (const comp of compsDepartementales) {
    const competitionId = await upsertCompetition(comp)
    if (!competitionId) continue

    console.log(`→ ${comp.nom} (c-${comp.c})`)

    let consecutifsVides = 0
    let nbTrouves = 0

    for (let s = maxSConnu + 1; s <= maxSConnu + 3000; s++) {
      const result = await probeTeam(comp.c, s)

      if (result) {
        consecutifsVides = 0
        const { club, confiance } = await matcherClub(result.teamName)

        aValider.push({
          s,
          teamName: result.teamName,
          nomNettoye: nettoyerNom(result.teamName),
          competitionC: comp.c,
          competitionId,
          competitionNom: comp.nom,
          clubId: club?.id || null,
          clubNom: club?.nom || null,
          confiance,
        })

        if (club && confiance === 'exact') {
          await sauvegarderEquipe(s, result.teamName, competitionId, comp.c, club.id, confiance)
        }

        const icon = confiance === 'exact' ? '✓' : confiance === 'partiel' ? '~' : '?'
        console.log(`  ${icon} s-${s} → ${result.teamName}`)
        nbTrouves++

      } else {
        consecutifsVides++
        process.stdout.write('.')

        if (consecutifsVides >= ARRET_APRES) {
          console.log(`\n  Arrêt anticipé — ${nbTrouves} équipes trouvées`)
          break
        }
      }

      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`DÉCOUVERTE ÉQUIPES FFHB v3 — Saison ${SAISON}`)
  console.log(`Logique intelligente s- connus + scan ciblé`)
  console.log('═'.repeat(60))

  // Charger le JSON des compétitions
  if (!fs.existsSync(JSON_FILE)) {
    console.error(`\n✗ Fichier ${JSON_FILE} introuvable !`)
    console.error(`  Lance d'abord : node scripts/00-find-competitions.js`)
    process.exit(1)
  }

  const toutesCompetitions = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'))
  console.log(`\n${toutesCompetitions.length} compétitions dans le JSON`)

  // Identifier les NOUVELLES compétitions (pas encore en base)
  const nouvellesCompetitions = toutesCompetitions
  // On teste tous les c- du JSON, pas seulement les nouveaux
  // car un c- peut être "connu" en base avec l'ancien numéro de saison
  console.log(`${nouvellesCompetitions.length} compétitions à scanner`)

  // Récupérer tous les s- connus avec leur niveau
  const { data: teamIds } = await supabase
    .from('club_team_ids')
    .select(`
      ffhb_team_id,
      ffhb_competition_id,
      competitions (niveau)
    `)

  // Dédupliquer les s- (un s- peut apparaître dans plusieurs compétitions)
  // On garde le niveau le plus élevé pour chaque s-
  const niveauPriorite = { professionnel: 5, national: 4, regional: 3, departemental: 2, coupe: 1 }
  const equipesMap = new Map()

  for (const t of (teamIds || [])) {
    const s = t.ffhb_team_id
    const niveau = t.competitions?.niveau || 'departemental'
    const existing = equipesMap.get(s)

    if (!existing || (niveauPriorite[niveau] || 0) > (niveauPriorite[existing.niveau_ancien] || 0)) {
      equipesMap.set(s, {
        ffhb_team_id: s,
        niveau_ancien: niveau,
      })
    }
  }

  const equipesConnues = [...equipesMap.values()]
  const maxSConnu = Math.max(...equipesConnues.map(e => parseInt(e.ffhb_team_id)))

  console.log(`\n${equipesConnues.length} équipes connues en base`)
  console.log(`Max s- connu : ${maxSConnu}`)

  const aValider = []

  // ── ÉTAPE 1 ──
  if (nouvellesCompetitions.length > 0) {
    const resultats = await etape1(equipesConnues, nouvellesCompetitions)
    aValider.push(...resultats.filter(r => r.confiance !== 'exact'))
  } else {
    console.log('\n⚠ Aucune nouvelle compétition — toutes déjà en base')
  }

  // ── ÉTAPE 2 ──
  await etape2(maxSConnu, nouvellesCompetitions, aValider)

  // ── Générer le CSV pour validation manuelle ───────────────────────────────
  if (aValider.length > 0) {
    const lignesCSV = [
      'competition,c_id,s_id,nom_ics,nom_nettoye,suggestion,club_id_suggere,action',
      ...aValider.map(e => [
        e.competitionNom || '',
        e.competitionC || '',
        `s-${e.s}`,
        e.teamName || '',
        e.nomNettoye || nettoyerNom(e.teamName || ''),
        e.clubNom || '',
        e.clubId || '',
        e.confiance === 'partiel' ? 'CONFIRMER_OU_CORRIGER' : 'A_REMPLIR',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ]

    fs.writeFileSync('a-valider-manuellement.csv', lignesCSV.join('\n'))
    console.log(`\n✓ CSV créé : a-valider-manuellement.csv (${aValider.length} entrées)`)
  }

  // ── Résumé ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`)
  console.log('RÉSUMÉ FINAL')
  console.log('─'.repeat(60))
  console.log(`Équipes connues testées    : ${equipesConnues.length}`)
  console.log(`Nouvelles compétitions     : ${nouvellesCompetitions.length}`)
  console.log(`À valider manuellement     : ${aValider.length}`)
  console.log('─'.repeat(60))
  console.log('\nScan terminé !')
  console.log('→ Prochaine étape : node scripts/03-scrape-matchs.js')
}

run()
