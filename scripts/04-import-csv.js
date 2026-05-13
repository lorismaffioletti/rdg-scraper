// 04-import-csv.js
// Lit le CSV validé et met à jour Supabase :
//  - UUID confirmé      → upsert dans club_team_ids
//  - "Entente"          → crée un club placeholder entente + upsert club_team_ids
//  - "Le club n'existe pas" → crée un club placeholder + upsert club_team_ids
//  - Vide (A_REMPLIR)   → crée un club placeholder générique + upsert club_team_ids

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import { parse } from 'csv-parse/sync'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

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

// ─── Créer un club placeholder ────────────────────────────────────────────────
async function creerClubPlaceholder(nom, type = 'inconnu') {
  const nomNormalise = normaliser(nom)

  // Vérifier s'il existe déjà (doublon possible si même équipe dans 2 compétitions)
  const { data: existant } = await supabase
    .from('clubs')
    .select('id, nom')
    .eq('nom_normalise', nomNormalise)
    .single()

  if (existant) {
    return existant.id
  }

  // Créer le club
  const { data, error } = await supabase
    .from('clubs')
    .insert({
      nom: nom,
      nom_normalise: nomNormalise,
      logo_url: null,
      type_placeholder: type, // 'entente' | 'inconnu' | 'nexiste_pas'
    })
    .select('id')
    .single()

  if (error) {
    console.error(`  ✗ Erreur création club "${nom}":`, error.message)
    return null
  }

  return data.id
}

// ─── Upsert club_team_ids ─────────────────────────────────────────────────────
async function upsertTeamId(clubId, competitionId, ffhbTeamId, ffhbCompetitionId) {
  const { error } = await supabase
    .from('club_team_ids')
    .upsert({
      club_id: clubId,
      competition_id: competitionId,
      ffhb_team_id: ffhbTeamId,
      ffhb_competition_id: ffhbCompetitionId,
    }, { onConflict: 'ffhb_team_id,ffhb_competition_id' })

  if (error) {
    console.error(`  ✗ Erreur upsert team_id s-${ffhbTeamId}:`, error.message)
    return false
  }
  return true
}

// ─── Récupérer l'ID interne d'une compétition depuis son c_id FFHB ───────────
async function getCompetitionId(ffhbCompetitionId) {
  const { data, error } = await supabase
    .from('competitions')
    .select('id')
    .eq('ffhb_competition_id', String(ffhbCompetitionId))
    .single()

  if (error || !data) return null
  return data.id
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  // Lire le CSV
  const csvContent = fs.readFileSync('a-valider-manuellement.csv', 'utf-8')
  const lignes = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })

  console.log(`\n${lignes.length} lignes à traiter\n`)

  // Compteurs
  let nbConfirme = 0, nbEntente = 0, nbNexiste = 0, nbPlaceholder = 0, nbErreur = 0

  // Cache des competition_ids pour éviter N requêtes identiques
  const competitionCache = {}

  for (const ligne of lignes) {
    const { nom_ics, c_id, s_id, action, club_id_final } = ligne

    // Extraire le numéro de s_id (ex: "s-3302" → "3302")
    const ffhbTeamId = s_id.replace('s-', '')
    const ffhbCompetitionId = String(c_id)

    // Récupérer l'ID interne de la compétition (avec cache)
    if (!competitionCache[ffhbCompetitionId]) {
      competitionCache[ffhbCompetitionId] = await getCompetitionId(ffhbCompetitionId)
    }
    const competitionId = competitionCache[ffhbCompetitionId]

    if (!competitionId) {
      console.log(`  ⚠ Compétition c-${ffhbCompetitionId} introuvable — ligne ignorée`)
      nbErreur++
      continue
    }

    const valeur = (club_id_final || '').trim()

    // ── CAS 1 : UUID confirmé ──────────────────────────────────────────────
    if (valeur.match(/^[0-9a-f-]{36}$/i)) {
      const ok = await upsertTeamId(valeur, competitionId, ffhbTeamId, ffhbCompetitionId)
      if (ok) {
        console.log(`  ✓ ${nom_ics} → UUID confirmé`)
        nbConfirme++
      } else {
        nbErreur++
      }
    }

    // ── CAS 2 : Entente ────────────────────────────────────────────────────
    else if (valeur === 'Entente') {
      const clubId = await creerClubPlaceholder(nom_ics, 'entente')
      if (clubId) {
        await upsertTeamId(clubId, competitionId, ffhbTeamId, ffhbCompetitionId)
        console.log(`  🤝 ${nom_ics} → Entente créée`)
        nbEntente++
      } else {
        nbErreur++
      }
    }

    // ── CAS 3 : Le club n'existe pas ───────────────────────────────────────
    else if (valeur === "Le club n'existe pas") {
      const clubId = await creerClubPlaceholder(nom_ics, 'nexiste_pas')
      if (clubId) {
        await upsertTeamId(clubId, competitionId, ffhbTeamId, ffhbCompetitionId)
        console.log(`  ❓ ${nom_ics} → Club inexistant créé`)
        nbNexiste++
      } else {
        nbErreur++
      }
    }

    // ── CAS 4 : Vide — A_REMPLIR ───────────────────────────────────────────
    else if (!valeur) {
      const clubId = await creerClubPlaceholder(nom_ics, 'inconnu')
      if (clubId) {
        await upsertTeamId(clubId, competitionId, ffhbTeamId, ffhbCompetitionId)
        console.log(`  🔲 ${nom_ics} → Placeholder créé`)
        nbPlaceholder++
      } else {
        nbErreur++
      }
    }

    else {
      console.log(`  ⚠ Valeur inconnue pour "${nom_ics}": "${valeur}"`)
      nbErreur++
    }
  }

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`RÉSUMÉ`)
  console.log('─'.repeat(50))
  console.log(`✓ UUIDs confirmés    : ${nbConfirme}`)
  console.log(`🤝 Ententes créées   : ${nbEntente}`)
  console.log(`❓ Clubs inexistants  : ${nbNexiste}`)
  console.log(`🔲 Placeholders       : ${nbPlaceholder}`)
  console.log(`✗ Erreurs            : ${nbErreur}`)
  console.log(`Total traité         : ${nbConfirme + nbEntente + nbNexiste + nbPlaceholder}`)
  console.log('─'.repeat(50))
  console.log('\nImport terminé !')
}

run()
