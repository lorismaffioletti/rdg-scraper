// 02-discover-teams.js v2
// Découverte automatique des équipes FFHB
// Lit les compétitions depuis competitions-SAISON.json
// généré par 00-find-competitions.js

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
const SAISON          = '2026-2027'
const JSON_FILE       = `competitions-${SAISON}.json`
const BASE_URL        = 'https://competition-calendar.ffhandball.fr'
const DELAY_MS        = 300
const ARRET_APRES     = 500   // arrêt si X IDs vides consécutifs
const ID_START        = 1300  // plage de scan début
const ID_END          = 15000 // plage de scan fin (large pour couvrir nouveaux clubs)

// ─── Abréviations pour le matching ───────────────────────────────────────────
const ABREVIATIONS = {
  ' HB ':   ' HANDBALL ',
  ' HBA ':  ' HANDBALL ',
  ' HBC ':  ' HANDBALL CLUB ',
  ' HBM ':  ' HANDBALL ',
  ' HBF ':  ' HANDBALL ',
  ' HBS ':  ' HANDBALL ',
  ' ENT.':  ' ENTENTE',
  ' SP. ':  ' SPORT ',
  ' US ':   ' UNION SPORTIVE ',
  ' AS ':   ' ASSOCIATION SPORTIVE ',
  ' CA ':   ' CLUB ATHLETIQUE ',
  ' COM ':  ' COMITE OMNISPORTS ',
  ' SC ':   ' SPORTING CLUB ',
  ' AC ':   ' ATHLETIC CLUB ',
  ' SHB ':  ' SPORT HANDBALL ',
  ' AHB ':  ' AGGLOMERATION HANDBALL ',
  'HB$':    'HANDBALL',
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

// ─── Nettoyage nom (supprime suffixes réserves et catégories) ─────────────────
function nettoyerNom(nom) {
  let nettoye = nom
    .replace(/\s*\+\d+[MF]?\d*\s*/gi, '')
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/\s+\d+[A-Z]$/i, '')
    .replace(/\s+[A-Z]$/i, '')
    .replace(/\s+\d+$/i, '')
    .trim()

  // Applique le dictionnaire d'abréviations
  let majuscule = ' ' + nettoye.toUpperCase() + ' '
  for (const [abrev, complet] of Object.entries(ABREVIATIONS)) {
    majuscule = majuscule.replaceAll(abrev, complet)
  }

  return majuscule.trim()
}

// ─── Probe une équipe via son .ics ────────────────────────────────────────────
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

    return { teamName, nbMatchs: matchs.length, url }
  } catch {
    return null
  }
}

// ─── Matching club dans Supabase ──────────────────────────────────────────────
async function matcherClub(teamName) {
  const nomNettoye = nettoyerNom(teamName)
  const nomsATester = [...new Set([teamName, nomNettoye])]

  for (const nom of nomsATester) {
    const nomNormalise = normaliser(nom)

    // Niveau 1 : exact
    const { data: exact } = await supabase
      .from('clubs')
      .select('id, nom, nom_normalise')
      .eq('nom_normalise', nomNormalise)
      .single()
    if (exact) return { club: exact, confiance: 'exact' }

    // Niveau 2 : contenu dans
    const { data: partiel } = await supabase
      .from('clubs')
      .select('id, nom, nom_normalise')
      .ilike('nom_normalise', `%${nomNormalise}%`)
      .limit(1)
      .single()
    if (partiel) return { club: partiel, confiance: 'partiel' }
  }

  // Niveau 3 : mots en commun ≥ 60% (seuil relevé pour éviter faux positifs)
  const motsEquipe = normaliser(nettoyerNom(teamName))
    .split(' ')
    .filter(m => m.length > 3)

  if (motsEquipe.length > 0) {
    const { data: candidats } = await supabase
      .from('clubs')
      .select('id, nom, nom_normalise')
      .ilike('nom_normalise', `%${motsEquipe[0]}%`)
      .limit(10)

    if (candidats && candidats.length > 0) {
      let meilleur = null
      let meilleurScore = 0

      for (const candidat of candidats) {
        const motsClub = candidat.nom_normalise.split(' ').filter(m => m.length > 3)
        const motsCommuns = motsEquipe.filter(m => motsClub.includes(m))
        const score = motsCommuns.length / motsEquipe.length

        if (score > meilleurScore && score >= 0.6 && motsCommuns.length >= 2) {
          meilleurScore = score
          meilleur = candidat
        }
      }

      if (meilleur) return { club: meilleur, confiance: 'partiel' }
    }
  }

  return { club: null, confiance: 'aucun' }
}

// ─── Upsert compétition en base ───────────────────────────────────────────────
async function upsertCompetition(comp) {
  const nom = [
    comp.nom,
    comp.genre === 'M' ? 'Masculine' : 'Féminine',
  ].filter(Boolean).join(' ')

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
    console.error(`  ✗ Erreur compétition c-${comp.c}:`, error.message)
    return null
  }
  return data.id
}

// ─── Scan d'une compétition ───────────────────────────────────────────────────
async function scannerCompetition(comp) {
  const label = `${comp.nom} ${comp.genre} (${comp.lieu || 'France'})`
  console.log(`\n→ ${label} [c-${comp.c}]`)

  const competitionId = await upsertCompetition(comp)
  if (!competitionId) return []

  const equipesTrouvees = []
  let nbExact = 0, nbPartiel = 0, nbAucun = 0
  let consecutifsVides = 0

  for (let s = ID_START; s <= ID_END; s++) {
    const result = await probeTeam(comp.c, s)

    if (result) {
      consecutifsVides = 0

      const { club, confiance } = await matcherClub(result.teamName)

      equipesTrouvees.push({
        s,
        competition: label,
        competition_c: comp.c,
        teamName: result.teamName,
        nomNettoye: nettoyerNom(result.teamName),
        clubId: club?.id || null,
        clubNom: club?.nom || null,
        confiance,
      })

      if (club && confiance === 'exact') {
        // Sauvegarde automatique
        await supabase
          .from('club_team_ids')
          .upsert({
            club_id: club.id,
            competition_id: competitionId,
            ffhb_team_id: String(s),
            ffhb_competition_id: comp.c,
          }, { onConflict: 'ffhb_team_id,ffhb_competition_id' })

        await supabase
          .from('club_name_aliases')
          .upsert({
            club_id: club.id,
            alias: result.teamName,
            alias_normalise: normaliser(result.teamName),
            source: 'auto_exact',
          }, { onConflict: 'alias' })

        nbExact++
      } else if (club) {
        nbPartiel++
      } else {
        nbAucun++
      }

      const icon = confiance === 'exact' ? '✓' : confiance === 'partiel' ? '~' : '?'
      const detail = club ? `= ${club.nom}` : `(nettoyé: "${nettoyerNom(result.teamName)}")`
      console.log(`  ${icon} s-${s} → ${result.teamName} ${detail}`)

    } else {
      consecutifsVides++
      process.stdout.write('.')

      if (consecutifsVides >= ARRET_APRES) {
        console.log(`\n  Arrêt anticipé (${ARRET_APRES} IDs vides)`)
        break
      }
    }

    await new Promise(r => setTimeout(r, DELAY_MS))
  }

  console.log(`\n  ✓ ${nbExact} exacts | ~ ${nbPartiel} partiels | ? ${nbAucun} inconnus`)
  return equipesTrouvees
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`DÉCOUVERTE ÉQUIPES FFHB — Saison ${SAISON}`)
  console.log('═'.repeat(60))

  // Charger les compétitions depuis le JSON
  if (!fs.existsSync(JSON_FILE)) {
    console.error(`\n✗ Fichier ${JSON_FILE} introuvable !`)
    console.error(`  Lance d'abord : node scripts/00-find-competitions.js`)
    process.exit(1)
  }

  const competitions = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'))
  console.log(`\n${competitions.length} compétitions à scanner depuis ${JSON_FILE}\n`)

  const tousLesResultats = []

  for (const comp of competitions) {
    const equipes = await scannerCompetition(comp)
    tousLesResultats.push(...equipes)
  }

  // ─── Génération du CSV pour validation manuelle ───────────────────────────
  const aValider = tousLesResultats.filter(e => e.confiance !== 'exact')

  const lignesCSV = [
    'competition,c_id,s_id,nom_ics,nom_nettoye,suggestion,club_id_suggere,action',
    ...aValider.map(e => [
      e.competition,
      e.competition_c,
      `s-${e.s}`,
      e.teamName,
      e.nomNettoye,
      e.clubNom || '',
      e.clubId || '',
      e.confiance === 'partiel' ? 'CONFIRMER_OU_CORRIGER' : 'A_REMPLIR',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
  ]

  fs.writeFileSync('a-valider-manuellement.csv', lignesCSV.join('\n'))

  // ─── Résumé ───────────────────────────────────────────────────────────────
  const nbExact   = tousLesResultats.filter(e => e.confiance === 'exact').length
  const nbPartiel = tousLesResultats.filter(e => e.confiance === 'partiel').length
  const nbAucun   = tousLesResultats.filter(e => e.confiance === 'aucun').length

  console.log(`\n${'─'.repeat(60)}`)
  console.log('RÉSUMÉ FINAL')
  console.log('─'.repeat(60))
  console.log(`Compétitions scannées   : ${competitions.length}`)
  console.log(`Équipes trouvées        : ${tousLesResultats.length}`)
  console.log(`✓ Sauvegardées en base  : ${nbExact}`)
  console.log(`~ À confirmer           : ${nbPartiel}`)
  console.log(`? À remplir manuellement: ${nbAucun}`)
  console.log(`\nFichier CSV créé        : a-valider-manuellement.csv`)
  console.log('─'.repeat(60))
  console.log('\nScan terminé !')
  console.log('→ Prochaine étape : node scripts/03-scrape-matchs.js')
}

run()
