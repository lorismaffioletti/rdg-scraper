// 03-scrape-matchs.js
// Télécharge tous les .ics des équipes connues et insère les matchs en base

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import ical from 'node-ical'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const BASE_URL = 'https://competition-calendar.ffhandball.fr'
const DELAY_MS = 200

// ─── Normalisation du nom d'équipe ────────────────────────────────────────────
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

// ─── Parser un événement .ics en objet match ──────────────────────────────────
function parseEvent(event, competitionId, clubDomicileId, clubExterieurId) {
  // uid unique de l'événement ICS
  const uid = event.uid || null

  // Date/heure
  const dateHeure = event.start ? event.start.toISOString() : null

  // Résumé = "EQUIPE_DOM vs EQUIPE_EXT"
  const summary = event.summary || ''

  // Lieu = nom du gymnase
  const gymnase = event.location || null

  // Description peut contenir l'adresse
  const description = event.description || ''

  // Statut : à venir ou passé
  const maintenant = new Date()
  const statut = event.start && event.start > maintenant ? 'a_venir' : 'passe'

  // URL du match (dans les propriétés custom ICS)
  let urlMatch = null
  if (event.url) urlMatch = event.url

  return {
    uid_ics: uid,
    competition_id: competitionId,
    club_domicile_id: clubDomicileId,
    club_exterieur_id: clubExterieurId,
    date_heure: dateHeure,
    gymnase: gymnase,
    adresse_gymnase: null,  // pas disponible dans le .ics
    lat: null,
    lon: null,
    url_match: urlMatch,
    statut: statut,
    scraped_at: new Date().toISOString(),
  }
}

// ─── Télécharger et parser un .ics ───────────────────────────────────────────
async function fetchICS(c, s) {
  const url = `${BASE_URL}/c-${c}/s-${s}.ics`
  try {
    const events = await ical.async.fromURL(url)
    return Object.values(events).filter(e => e.type === 'VEVENT')
  } catch {
    return []
  }
}

// ─── Trouver le club adversaire depuis le summary ─────────────────────────────
// Le summary est "NOM_DOM vs NOM_EXT"
// On sait quel club est "nous" (clubNom), on cherche l'adversaire
async function trouverAdversaire(summary, clubNomNormalise) {
  if (!summary) return null

  const parties = summary.split(' vs ')
  if (parties.length !== 2) return null

  const nomDom = normaliser(parties[0].trim())
  const nomExt = normaliser(parties[1].trim())

  // Lequel est nous ?
  const nousEteDomicile = nomDom.includes(clubNomNormalise) || clubNomNormalise.includes(nomDom)
  const nomAdversaire = nousEteDomicile ? parties[1].trim() : parties[0].trim()
  const nomAdvNormalise = normaliser(nomAdversaire)

  // Chercher l'adversaire en base
  // Niveau 1 : exact
  const { data: exact } = await supabase
    .from('clubs')
    .select('id')
    .eq('nom_normalise', nomAdvNormalise)
    .single()
  if (exact) return { id: exact.id, domicile: nousEteDomicile }

  // Niveau 2 : partiel
  const { data: partiel } = await supabase
    .from('clubs')
    .select('id')
    .ilike('nom_normalise', `%${nomAdvNormalise}%`)
    .limit(1)
    .single()
  if (partiel) return { id: partiel.id, domicile: nousEteDomicile }

  // Niveau 3 : premier mot significatif
  const mots = nomAdvNormalise.split(' ').filter(m => m.length > 3)
  if (mots.length > 0) {
    const { data: motClef } = await supabase
      .from('clubs')
      .select('id')
      .ilike('nom_normalise', `%${mots[0]}%`)
      .limit(1)
      .single()
    if (motClef) return { id: motClef.id, domicile: nousEteDomicile }
  }

  return null
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('Chargement des équipes depuis club_team_ids...\n')

  // Récupérer toutes les liaisons équipe ↔ club ↔ compétition
  const { data: teamIds, error } = await supabase
    .from('club_team_ids')
    .select(`
      ffhb_team_id,
      ffhb_competition_id,
      competition_id,
      club_id,
      clubs (id, nom, nom_normalise)
    `)

  if (error) {
    console.error('Erreur chargement club_team_ids:', error.message)
    return
  }

  console.log(`${teamIds.length} équipes à scraper\n`)

  let nbMatchs = 0
  let nbNouveaux = 0
  let nbDoublons = 0
  let nbErreurs = 0

  for (const equipe of teamIds) {
    const { ffhb_team_id, ffhb_competition_id, competition_id, club_id, clubs: club } = equipe
    const clubNomNormalise = club?.nom_normalise || ''

    process.stdout.write(`→ s-${ffhb_team_id} (${club?.nom || '?'}) `)

    const events = await fetchICS(ffhb_competition_id, ffhb_team_id)

    if (events.length === 0) {
      process.stdout.write(`— 0 matchs\n`)
      await new Promise(r => setTimeout(r, DELAY_MS))
      continue
    }

    let nbEquipe = 0

    for (const event of events) {
      const summary = event.summary || ''

      // Déterminer domicile/extérieur et trouver l'adversaire
      const adversaire = await trouverAdversaire(summary, clubNomNormalise)

      let clubDomicileId, clubExterieurId

      if (adversaire) {
        clubDomicileId = adversaire.domicile ? club_id : adversaire.id
        clubExterieurId = adversaire.domicile ? adversaire.id : club_id
      } else {
        // On ne sait pas qui est l'adversaire — on met null
        // On met le club connu en domicile par défaut si son nom est en premier
        const parties = summary.split(' vs ')
        const nomDom = normaliser(parties[0]?.trim() || '')
        const nousEteDomicile = nomDom.includes(clubNomNormalise) || clubNomNormalise.includes(nomDom)
        clubDomicileId = nousEteDomicile ? club_id : null
        clubExterieurId = nousEteDomicile ? null : club_id
      }

      const match = parseEvent(event, competition_id, clubDomicileId, clubExterieurId)

      // Ignorer les matchs sans date
      if (!match.date_heure) continue

      // Upsert sur uid_ics pour éviter les doublons
      const { error: upsertError, data: upsertData } = await supabase
        .from('matchs')
        .upsert(match, { onConflict: 'uid_ics', ignoreDuplicates: false })
        .select('id')

      if (upsertError) {
        nbErreurs++
      } else {
        nbEquipe++
        nbMatchs++
      }

      await new Promise(r => setTimeout(r, 50))
    }

    process.stdout.write(`— ${nbEquipe} matchs\n`)
    await new Promise(r => setTimeout(r, DELAY_MS))
  }

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`RÉSUMÉ FINAL`)
  console.log('─'.repeat(50))
  console.log(`Équipes scrapées  : ${teamIds.length}`)
  console.log(`Matchs insérés    : ${nbMatchs}`)
  console.log(`Erreurs           : ${nbErreurs}`)
  console.log('─'.repeat(50))
  console.log('\nScraping terminé !')
}

run()
