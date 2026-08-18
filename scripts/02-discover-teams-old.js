// 02-discover-teams.js
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import ical from 'node-ical'
import fs from 'fs'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const BASE_URL = 'https://competition-calendar.ffhandball.fr'
const DELAY_MS = 300
const ARRET_APRES = 200

const COMPETITIONS = [
  { competition: 'Nationale 1', niveau: 'national', lieu: 'France', genre: 'M', c: '28229', idStart: 3000, idEnd: 3600 },
  { competition: 'Nationale 2', niveau: 'national', lieu: 'France', genre: 'M', c: '28230', idStart: 3000, idEnd: 3600 },
  { competition: 'Nationale 3', niveau: 'national', lieu: 'France', genre: 'M', c: '28559', idStart: 3000, idEnd: 3600 },
  { competition: 'Nationale 1', niveau: 'national', lieu: 'France', genre: 'F', c: '28626', idStart: 3000, idEnd: 3600 },
  { competition: 'Nationale 2', niveau: 'national', lieu: 'France', genre: 'F', c: '28560', idStart: 3000, idEnd: 3600 },
  { competition: 'R1', niveau: 'regional', lieu: 'Île-de-France', genre: 'M', c: '28402', idStart: 3100, idEnd: 3600 },
  { competition: 'R2', niveau: 'regional', lieu: 'Île-de-France', genre: 'M', c: '28404', idStart: 3100, idEnd: 3600 },
  { competition: 'R3', niveau: 'regional', lieu: 'Île-de-France', genre: 'M', c: '28406', idStart: 3100, idEnd: 3600 },
  { competition: 'R1', niveau: 'regional', lieu: 'Île-de-France', genre: 'F', c: '28398', idStart: 3100, idEnd: 3600 },
  { competition: 'R2', niveau: 'regional', lieu: 'Île-de-France', genre: 'F', c: '28403', idStart: 3100, idEnd: 3600 },
  { competition: 'R3', niveau: 'regional', lieu: 'Île-de-France', genre: 'F', c: '28405', idStart: 3100, idEnd: 3600 },
  { competition: 'D1', niveau: 'departemental', lieu: '94', genre: 'M', c: '28531', idStart: 3100, idEnd: 3600 },
  { competition: 'D2', niveau: 'departemental', lieu: '94', genre: 'M', c: '28532', idStart: 3100, idEnd: 3600 },
  { competition: 'D3', niveau: 'departemental', lieu: '94', genre: 'M', c: '28533', idStart: 3100, idEnd: 3600 },
  { competition: 'D4', niveau: 'departemental', lieu: '94', genre: 'M', c: '28959', idStart: 3100, idEnd: 3600 },
  { competition: 'D1', niveau: 'departemental', lieu: '94', genre: 'F', c: '28534', idStart: 3100, idEnd: 3600 },
  { competition: 'D1', niveau: 'departemental', lieu: '95', genre: 'M', c: '28620', idStart: 3300, idEnd: 3600 },
  { competition: 'D2', niveau: 'departemental', lieu: '95', genre: 'M', c: '28622', idStart: 3300, idEnd: 3600 },
  { competition: 'D1', niveau: 'departemental', lieu: '95', genre: 'F', c: '28621', idStart: 3300, idEnd: 3600 },
  { competition: 'D1', niveau: 'departemental', lieu: '93', genre: 'M', c: '28654', idStart: 3100, idEnd: 3600 },
  { competition: 'D2', niveau: 'departemental', lieu: '93', genre: 'M', c: '28656', idStart: 3100, idEnd: 3600 },
  { competition: 'D1', niveau: 'departemental', lieu: '93', genre: 'F', c: '28651', idStart: 3100, idEnd: 3600 },
  { competition: 'D1', niveau: 'departemental', lieu: '92', genre: 'M', c: '28784', idStart: 3100, idEnd: 3600 },
  { competition: 'D2', niveau: 'departemental', lieu: '92', genre: 'M', c: '28786', idStart: 3100, idEnd: 3600 },
  { competition: 'D3', niveau: 'departemental', lieu: '92', genre: 'M', c: '28787', idStart: 3100, idEnd: 3600 },
  { competition: 'D1', niveau: 'departemental', lieu: '92', genre: 'F', c: '28791', idStart: 3100, idEnd: 3600 },
  { competition: 'Corpo', niveau: 'departemental', lieu: '75', genre: 'M', c: '29233', idStart: 3100, idEnd: 3300 },
  { competition: 'D1', niveau: 'departemental', lieu: '91', genre: 'M', c: '28235', idStart: 3200, idEnd: 3600 },
  { competition: 'D2', niveau: 'departemental', lieu: '91', genre: 'M', c: '28236', idStart: 3200, idEnd: 3600 },
  { competition: 'D3', niveau: 'departemental', lieu: '91', genre: 'M', c: '28237', idStart: 3200, idEnd: 3600 },
  { competition: 'D4', niveau: 'departemental', lieu: '91', genre: 'M', c: '28238', idStart: 3200, idEnd: 3600 },
  { competition: 'D1', niveau: 'departemental', lieu: '91', genre: 'F', c: '28286', idStart: 3200, idEnd: 3600 },
  { competition: 'D2', niveau: 'departemental', lieu: '91', genre: 'F', c: '28785', idStart: 3200, idEnd: 3600 },
  { competition: 'D1', niveau: 'departemental', lieu: '78', genre: 'M', c: '28458', idStart: 3100, idEnd: 3600 },
  { competition: 'D2', niveau: 'departemental', lieu: '78', genre: 'M', c: '28459', idStart: 3100, idEnd: 3600 },
  { competition: 'D3', niveau: 'departemental', lieu: '78', genre: 'M', c: '28460', idStart: 3100, idEnd: 3600 },
  { competition: 'D1', niveau: 'departemental', lieu: '78', genre: 'F', c: '28455', idStart: 3100, idEnd: 3600 },
  { competition: 'D2', niveau: 'departemental', lieu: '78', genre: 'F', c: '28457', idStart: 3100, idEnd: 3600 },
  { competition: 'D1', niveau: 'departemental', lieu: '77', genre: 'M', c: '27914', idStart: 3100, idEnd: 3600 },
  { competition: 'D2', niveau: 'departemental', lieu: '77', genre: 'M', c: '27915', idStart: 3100, idEnd: 3600 },
  { competition: 'D3', niveau: 'departemental', lieu: '77', genre: 'M', c: '27916', idStart: 3100, idEnd: 3600 },
  { competition: 'D4', niveau: 'departemental', lieu: '77', genre: 'M', c: '27917', idStart: 3100, idEnd: 3600 },
  { competition: 'D1', niveau: 'departemental', lieu: '77', genre: 'F', c: '27918', idStart: 3100, idEnd: 3600 },
  { competition: 'D2', niveau: 'departemental', lieu: '77', genre: 'F', c: '27919', idStart: 3100, idEnd: 3600 },
]

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

// ─── Dictionnaire d'abréviations ─────────────────────────────────────────────
const ABREVIATIONS = {
  ' HB ':   ' HANDBALL ',
  ' HBA ':  ' HANDBALL ',
  ' HBC ':  ' HANDBALL CLUB ',
  ' HBM ':  ' HANDBALL ',
  ' HBF ':  ' HANDBALL ',
  ' HBS ':  ' HANDBALL ',
  ' ENT.':  ' ENTENTE',
  ' SP. ':  ' SPORT ',
  ' SP$':   ' SPORT',
  ' US ':   ' UNION SPORTIVE ',
  ' AS ':   ' ASSOCIATION SPORTIVE ',
  ' CA ':   ' CLUB ATHLETIQUE ',
  ' COM ':  ' COMITE OMNISPORTS ',
  ' SC ':   ' SPORTING CLUB ',
  ' AC ':   ' ATHLETIC CLUB ',
  ' EC ':   ' ENTENTE CLUB ',
  ' SHB ':  ' SPORT HANDBALL ',
  ' AHB ':  ' AGGLOMERATION HANDBALL ',
  ' PHB ':  ' PAYS HANDBALL ',
  'HB$':    'HANDBALL',
}

function nettoyerNom(nom) {
  // Supprime les suffixes de réserves
  let nettoye = nom
    .replace(/\s*\+\d+[MF]?\d*\s*/gi, '')
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/\s+\d+[A-Z]$/i, '')
    .replace(/\s+[A-Z]$/i, '')
    .replace(/\s+\d+$/i, '')
    .trim()

  // Applique le dictionnaire d'abréviations
  // On travaille en majuscules pour la comparaison
  let majuscule = ' ' + nettoye.toUpperCase() + ' '
  for (const [abrev, complet] of Object.entries(ABREVIATIONS)) {
    majuscule = majuscule.replaceAll(abrev, complet)
  }

  return majuscule.trim()
}

// ─── Extraction nom depuis .ics ───────────────────────────────────────────────
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

    // Niveau 2 : nom équipe contenu dans nom club
    const { data: partiel } = await supabase
      .from('clubs')
      .select('id, nom, nom_normalise')
      .ilike('nom_normalise', `%${nomNormalise}%`)
      .limit(1)
      .single()
    if (partiel) return { club: partiel, confiance: 'partiel' }

    // Niveau 3 : matching inversé — nom club contenu dans nom équipe
    const { data: tous } = await supabase
      .from('clubs')
      .select('id, nom, nom_normalise')
      .limit(2000)

    if (tous) {
      for (const club of tous) {
        if (nomNormalise.includes(club.nom_normalise) && club.nom_normalise.length > 5) {
          return { club, confiance: 'partiel' }
        }
      }
    }
  }

  // Niveau 4 : mots en commun (≥50%)
  const motsEquipe = normaliser(nomNettoye)
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

        if (score > meilleurScore && score >= 0.5) {
          meilleurScore = score
          meilleur = candidat
        }
      }

      if (meilleur) return { club: meilleur, confiance: 'partiel' }
    }
  }

  return { club: null, confiance: 'aucun' }
}

async function upsertCompetition(comp) {
  const { data, error } = await supabase
    .from('competitions')
    .upsert({
      ffhb_competition_id: comp.c,
      nom: `${comp.competition} ${comp.genre === 'M' ? 'Masculine' : 'Féminine'}`,
      region: comp.lieu,
      saison: '2025-2026',
    }, { onConflict: 'ffhb_competition_id' })
    .select('id')
    .single()

  if (error) {
    console.error(`Erreur compétition ${comp.c}:`, error.message)
    return null
  }
  return data.id
}

async function scannerCompetition(comp) {
  const label = `${comp.competition} ${comp.genre} ${comp.lieu}`
  const total = comp.idEnd - comp.idStart
  console.log(`\n→ Scan ${label} (c-${comp.c}) — IDs ${comp.idStart} à ${comp.idEnd} (~${Math.round(total * DELAY_MS / 1000)}s)`)

  const competitionId = await upsertCompetition(comp)
  if (!competitionId) return []

  const equipesTrouvees = []
  let exact = 0, partiel = 0, aucun = 0
  let consecutifsVides = 0

  for (let s = comp.idStart; s <= comp.idEnd; s++) {
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

        exact++
      } else if (club) {
        partiel++
      } else {
        aucun++
      }

      const icon = confiance === 'exact' ? '✓' : confiance === 'partiel' ? '~' : '?'
      const detail = club ? `= ${club.nom}` : `(nettoyé: "${nettoyerNom(result.teamName)}")`
      console.log(`  ${icon} s-${s} → ${result.teamName} ${detail}`)

    } else {
      consecutifsVides++
      process.stdout.write('.')

      if (consecutifsVides >= ARRET_APRES) {
        console.log(`\n  Arrêt anticipé après ${ARRET_APRES} IDs vides consécutifs`)
        break
      }
    }

    await new Promise(r => setTimeout(r, DELAY_MS))
  }

  console.log(`\n  Résultat : ${equipesTrouvees.length} équipes`)
  console.log(`  ✓ Exact: ${exact} | ~ Partiel: ${partiel} | ? Aucun: ${aucun}`)

  return equipesTrouvees
}

async function run() {
  console.log(`Démarrage — ${COMPETITIONS.length} compétitions\n`)

  const tousLesResultats = []

  for (const comp of COMPETITIONS) {
    const equipes = await scannerCompetition(comp)
    tousLesResultats.push(...equipes)
  }

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
    ].map(v => `"${v}"`).join(','))
  ]

  fs.writeFileSync('a-valider-manuellement.csv', lignesCSV.join('\n'))

  const nbExact = tousLesResultats.filter(e => e.confiance === 'exact').length
  const nbPartiel = tousLesResultats.filter(e => e.confiance === 'partiel').length
  const nbAucun = tousLesResultats.filter(e => e.confiance === 'aucun').length

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`RÉSUMÉ FINAL`)
  console.log('─'.repeat(50))
  console.log(`✓ Sauvegardés en base   : ${nbExact} équipes`)
  console.log(`~ À confirmer           : ${nbPartiel} équipes`)
  console.log(`? À remplir manuellement: ${nbAucun} équipes`)
  console.log(`Total                   : ${tousLesResultats.length} équipes`)
  console.log(`\nFichier créé : a-valider-manuellement.csv`)
  console.log('─'.repeat(50))
  console.log('\nScan terminé !')
}

run()