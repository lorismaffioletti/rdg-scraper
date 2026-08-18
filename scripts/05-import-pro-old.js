// 05-import-pro.js
// Importe les équipes et matchs des compétitions professionnelles
// On connaît déjà les s- et c- exactement — pas besoin de scanner

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import ical from 'node-ical'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const BASE_URL = 'https://competition-calendar.ffhandball.fr'
const DELAY_MS = 300

// ─── Compétitions pro avec leurs équipes connues ──────────────────────────────
const COMPETITIONS_PRO = [
  {
    competition: 'LIQUI MOLY Starligue',
    niveau: 'professionnel',
    genre: 'M',
    c: '28399',
    equipes: [1386,1721,1866,1966,2163,2252,2280,2456,2490,2569,2920,3158,3214,3519,3537,3612],
  },
  {
    competition: 'Proligue',
    niveau: 'professionnel',
    genre: 'M',
    c: '28551',
    equipes: [1583,1677,2037,2199,2375,2495,2639,2785,2827,2993,3113,3168,3169,3259,3443],
  },
  {
    competition: 'Ligue Butagaz Energie',
    niveau: 'professionnel',
    genre: 'F',
    c: '28227',
    equipes: [1720,1791,2010,2129,2325,2331,2394,2662,2897,3172,3321,3550,3920,3987],
  },
  {
    competition: 'Division 2 Féminine',
    niveau: 'professionnel',
    genre: 'F',
    c: '28228',
    equipes: [1508,1551,1897,2182,2378,2456,2461,2728,3059,10425],
  },
]

// ─── EHF — URL directe ────────────────────────────────────────────────────────
const EHF_URL = 'https://www.eurohandball.com/umbraco/api/calendarapi/GetCalendarEventFile?culture=en-US&contentId=1162'

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

// ─── Récupérer ou créer une compétition ──────────────────────────────────────
async function upsertCompetition(comp) {
  const { data, error } = await supabase
    .from('competitions')
    .upsert({
      ffhb_competition_id: comp.c,
      nom: `${comp.competition} ${comp.genre === 'M' ? 'Masculine' : 'Féminine'}`,
      region: 'France',
      saison: '2025-2026',
    }, { onConflict: 'ffhb_competition_id' })
    .select('id')
    .single()

  if (error) {
    console.error(`  ✗ Erreur compétition ${comp.c}:`, error.message)
    return null
  }
  return data.id
}

// ─── Trouver un club depuis le nom dans le .ics ───────────────────────────────
async function trouverClub(teamName) {
  const nomNormalise = normaliser(teamName)

  // Niveau 1 : exact
  const { data: exact } = await supabase
    .from('clubs')
    .select('id, nom')
    .eq('nom_normalise', nomNormalise)
    .single()
  if (exact) return { id: exact.id, confiance: 'exact' }

  // Niveau 2 : partiel
  const { data: partiel } = await supabase
    .from('clubs')
    .select('id, nom')
    .ilike('nom_normalise', `%${nomNormalise}%`)
    .limit(1)
    .single()
  if (partiel) return { id: partiel.id, confiance: 'partiel' }

  // Niveau 3 : mots clés
  const mots = nomNormalise.split(' ').filter(m => m.length > 3)
  if (mots.length > 0) {
    const { data: motClef } = await supabase
      .from('clubs')
      .select('id, nom')
      .ilike('nom_normalise', `%${mots[0]}%`)
      .limit(1)
      .single()
    if (motClef) return { id: motClef.id, confiance: 'partiel' }
  }

  // Créer un placeholder si introuvable
  const { data: nouveau } = await supabase
    .from('clubs')
    .insert({
      nom: teamName,
      nom_normalise: nomNormalise,
      logo_url: null,
      type_placeholder: 'pro',
    })
    .select('id')
    .single()

  return nouveau ? { id: nouveau.id, confiance: 'nouveau' } : null
}

// ─── Scraper un .ics FFHB et insérer les matchs ───────────────────────────────
async function scraperEquipe(c, s, competitionId) {
  const url = `${BASE_URL}/c-${c}/s-${s}.ics`
  let events = []

  try {
    const raw = await ical.async.fromURL(url)
    events = Object.values(raw).filter(e => e.type === 'VEVENT')
  } catch {
    return { nbMatchs: 0, erreur: true }
  }

  if (events.length === 0) return { nbMatchs: 0, erreur: false }

  // Trouver le nom de l'équipe (le nom le plus fréquent en position domicile)
  const comptage = {}
  for (const event of events) {
    const nom = event.summary?.split(' vs ')[0]?.trim()
    if (nom) comptage[nom] = (comptage[nom] || 0) + 1
  }
  const nomEquipe = Object.entries(comptage).sort((a, b) => b[1] - a[1])[0]?.[0]
  const nomEquipeNorm = normaliser(nomEquipe || '')

  // Trouver ou créer le club
  const clubResult = await trouverClub(nomEquipe || `Équipe s-${s}`)
  if (!clubResult) return { nbMatchs: 0, erreur: true }

  // Upsert dans club_team_ids
  await supabase
    .from('club_team_ids')
    .upsert({
      club_id: clubResult.id,
      competition_id: competitionId,
      ffhb_team_id: String(s),
      ffhb_competition_id: String(c),
    }, { onConflict: 'ffhb_team_id,ffhb_competition_id' })

  // Insérer les matchs
  let nbMatchs = 0
  for (const event of events) {
    const summary = event.summary || ''
    const parties = summary.split(' vs ')
    if (parties.length !== 2) continue

    const nomDom = normaliser(parties[0].trim())
    const nomExt = normaliser(parties[1].trim())
    const nousEteDomicile = nomDom.includes(nomEquipeNorm) || nomEquipeNorm.includes(nomDom)

    const adversaireNom = nousEteDomicile ? parties[1].trim() : parties[0].trim()
    const adversaire = await trouverClub(adversaireNom)

    const clubDomicileId = nousEteDomicile ? clubResult.id : adversaire?.id || null
    const clubExterieurId = nousEteDomicile ? adversaire?.id || null : clubResult.id

    const statut = event.start && event.start > new Date() ? 'a_venir' : 'passe'

    await supabase
      .from('matchs')
      .upsert({
        uid_ics: event.uid || null,
        competition_id: competitionId,
        club_domicile_id: clubDomicileId,
        club_exterieur_id: clubExterieurId,
        date_heure: event.start?.toISOString() || null,
        gymnase: event.location || null,
        adresse_gymnase: null,
        lat: null,
        lon: null,
        url_match: event.url || null,
        statut,
        scraped_at: new Date().toISOString(),
      }, { onConflict: 'uid_ics', ignoreDuplicates: false })

    nbMatchs++
    await new Promise(r => setTimeout(r, 50))
  }

  return { nbMatchs, nomEquipe, confiance: clubResult.confiance }
}

// ─── Scraper le .ics EHF ──────────────────────────────────────────────────────
async function scraperEHF() {
  console.log('\n→ Scraping EHF (Ligue des Champions, Coupe d\'Europe, Équipes de France)')

  // Upsert compétition EHF générique
  const { data: compEHF } = await supabase
    .from('competitions')
    .upsert({
      ffhb_competition_id: 'ehf-2025-2026',
      nom: 'Compétitions EHF 2025-2026',
      region: 'Europe',
      saison: '2025-2026',
    }, { onConflict: 'ffhb_competition_id' })
    .select('id')
    .single()

  if (!compEHF) {
    console.log('  ✗ Erreur création compétition EHF')
    return
  }

  let events = []
  try {
    const raw = await ical.async.fromURL(EHF_URL)
    events = Object.values(raw).filter(e => e.type === 'VEVENT')
  } catch (err) {
    console.log('  ✗ Erreur fetch EHF:', err.message)
    return
  }

  console.log(`  ${events.length} matchs trouvés`)

  let nbInseres = 0
  for (const event of events) {
    const summary = event.summary || ''
    const parties = summary.split(' vs ')
    if (parties.length !== 2) continue

    const clubDom = await trouverClub(parties[0].trim())
    const clubExt = await trouverClub(parties[1].trim())

    const statut = event.start && event.start > new Date() ? 'a_venir' : 'passe'

    // Extraire la compétition depuis la description
    const desc = event.description || ''
    const lignes = desc.replace(/\\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean)
    const nomComp = lignes[1] || 'EHF'
    const lieu = lignes[2] || null

    await supabase
      .from('matchs')
      .upsert({
        uid_ics: event.uid || null,
        competition_id: compEHF.id,
        club_domicile_id: clubDom?.id || null,
        club_exterieur_id: clubExt?.id || null,
        date_heure: event.start?.toISOString() || null,
        gymnase: lieu,
        adresse_gymnase: null,
        lat: null,
        lon: null,
        url_match: event.url || null,
        statut,
        scraped_at: new Date().toISOString(),
      }, { onConflict: 'uid_ics', ignoreDuplicates: false })

    nbInseres++
    await new Promise(r => setTimeout(r, 50))
  }

  console.log(`  ✓ ${nbInseres} matchs EHF insérés`)
}

// ─── TV Sports .ics ───────────────────────────────────────────────────────────
async function scraperTV() {
  console.log('\n→ Scraping TV Sports (diffusions handball)')

  const TV_URL = 'https://tv-sports.fr/calendrier/sport/143/handball?direct=1'

  // Compétition TV générique
  const { data: compTV } = await supabase
    .from('competitions')
    .upsert({
      ffhb_competition_id: 'tv-sports-handball',
      nom: 'Diffusions TV Handball',
      region: 'France',
      saison: '2025-2026',
    }, { onConflict: 'ffhb_competition_id' })
    .select('id')
    .single()

  if (!compTV) {
    console.log('  ✗ Erreur création compétition TV')
    return
  }

  let events = []
  try {
    const raw = await ical.async.fromURL(TV_URL)
    events = Object.values(raw).filter(e => e.type === 'VEVENT')
  } catch (err) {
    console.log('  ✗ Erreur fetch TV Sports:', err.message)
    return
  }

  console.log(`  ${events.length} diffusions trouvées`)

  let nbInseres = 0
  for (const event of events) {
    const summary = event.summary || ''

    // Format : "🤾 Nantes / Montpellier (beIN SPORTS 3)"
    // Extraire diffuseur depuis les parenthèses
    const diffuseurMatch = summary.match(/\(([^)]+)\)/)
    const diffuseur = diffuseurMatch ? diffuseurMatch[1] : null

    // Nettoyer le résumé pour avoir juste les équipes
    const cleanSummary = summary
      .replace(/🤾\s*/g, '')
      .replace(/\s*\([^)]+\)/, '')
      .trim()

    const parties = cleanSummary.split(' / ')
    const clubDom = parties.length === 2 ? await trouverClub(parties[0].trim()) : null
    const clubExt = parties.length === 2 ? await trouverClub(parties[1].trim()) : null

    const statut = event.start && event.start > new Date() ? 'a_venir' : 'passe'

    await supabase
      .from('matchs')
      .upsert({
        uid_ics: event.uid || null,
        competition_id: compTV.id,
        club_domicile_id: clubDom?.id || null,
        club_exterieur_id: clubExt?.id || null,
        date_heure: event.start?.toISOString() || null,
        gymnase: null,
        adresse_gymnase: null,
        lat: null,
        lon: null,
        url_match: event.url || null,
        statut,
        diffuseur,
        scraped_at: new Date().toISOString(),
      }, { onConflict: 'uid_ics', ignoreDuplicates: false })

    nbInseres++
    await new Promise(r => setTimeout(r, 50))
  }

  console.log(`  ✓ ${nbInseres} diffusions TV insérées`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('=== Import compétitions professionnelles + EHF + TV ===\n')

  let totalMatchs = 0
  let totalEquipes = 0

  // ── Compétitions pro FFHB ──
  for (const comp of COMPETITIONS_PRO) {
    console.log(`\n► ${comp.competition} ${comp.genre} (c-${comp.c}) — ${comp.equipes.length} équipes`)

    const competitionId = await upsertCompetition(comp)
    if (!competitionId) continue

    for (const s of comp.equipes) {
      const result = await scraperEquipe(comp.c, s, competitionId)

      if (result.erreur) {
        console.log(`  ✗ s-${s} — erreur`)
      } else if (result.nbMatchs === 0) {
        console.log(`  · s-${s} — 0 matchs`)
      } else {
        const icon = result.confiance === 'exact' ? '✓' : result.confiance === 'nouveau' ? '★' : '~'
        console.log(`  ${icon} s-${s} — ${result.nomEquipe} — ${result.nbMatchs} matchs`)
        totalMatchs += result.nbMatchs
        totalEquipes++
      }

      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }

  // ── EHF ──
  await scraperEHF()

  // ── TV Sports ──
  await scraperTV()

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`RÉSUMÉ`)
  console.log('─'.repeat(50))
  console.log(`Équipes pro traitées : ${totalEquipes}`)
  console.log(`Matchs pro insérés   : ${totalMatchs}`)
  console.log('─'.repeat(50))
  console.log('\nImport terminé !')
}

run()
