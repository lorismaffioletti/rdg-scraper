// 05-import-pro.js v2
// Import compétitions pro + EHF + TV
// Logique internationale 3 couches + fusion TV ±3h

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import ical from 'node-ical'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const BASE_URL = 'https://competition-calendar.ffhandball.fr'
const EHF_URL = 'https://www.eurohandball.com/umbraco/api/calendarapi/GetCalendarEventFile?culture=en-US&contentId=1162'
const TV_URL = 'https://tv-sports.fr/calendrier/sport/143/handball?direct=1'
const LNH_TV_URL = 'https://www.addevent.com/feed/eeuhamusw.ics'
const DELAY_MS = 200
const TV_FENETRE_HEURES = 3

const COMPETITIONS_PRO = [
  { competition: 'LIQUI MOLY Starligue', niveau: 'professionnel', genre: 'M', c: '28399',
    equipes: [1386,1721,1866,1966,2163,2252,2280,2456,2490,2569,2920,3158,3214,3519,3537,3612] },
  { competition: 'Proligue', niveau: 'professionnel', genre: 'M', c: '28551',
    equipes: [1583,1677,2037,2199,2375,2495,2639,2785,2827,2993,3113,3168,3169,3259,3443] },
  { competition: 'Ligue Butagaz Energie', niveau: 'professionnel', genre: 'F', c: '28227',
    equipes: [1720,1791,2010,2129,2325,2331,2394,2662,2897,3172,3321,3550,3920,3987] },
  { competition: 'Division 2 Feminine', niveau: 'professionnel', genre: 'F', c: '28228',
    equipes: [1508,1551,1897,2182,2378,2456,2461,2728,3059,10425] },
]

function normaliser(texte) {
  if (!texte) return ''
  return texte.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

const cacheClubs = {}
const cacheMappings = {}

async function chercherDansClubs(nomNormalise) {
  if (cacheClubs[nomNormalise]) return cacheClubs[nomNormalise]
  const { data: exact } = await supabase.from('clubs').select('id, nom, nom_normalise, pays_id')
    .eq('nom_normalise', nomNormalise).single()
  if (exact) { cacheClubs[nomNormalise] = exact; return exact }

  if (nomNormalise.length > 5) {
    const { data: partiel } = await supabase.from('clubs').select('id, nom, nom_normalise, pays_id')
      .ilike('nom_normalise', `%${nomNormalise}%`).limit(1).single()
    if (partiel && nomNormalise.length / partiel.nom_normalise.length >= 0.4) {
      cacheClubs[nomNormalise] = partiel; return partiel
    }
  }

  const mots = nomNormalise.split(' ').filter(m => m.length > 4)
  if (mots.length > 0) {
    const { data: candidats } = await supabase.from('clubs').select('id, nom, nom_normalise, pays_id')
      .ilike('nom_normalise', `%${mots[0]}%`).limit(10)
    if (candidats?.length > 0) {
      let meilleur = null, meilleurScore = 0
      for (const c of candidats) {
        const motsC = c.nom_normalise.split(' ').filter(m => m.length > 4)
        const score = mots.filter(m => motsC.includes(m)).length / mots.length
        if (score > meilleurScore && score >= 0.6) { meilleurScore = score; meilleur = c }
      }
      if (meilleur) { cacheClubs[nomNormalise] = meilleur; return meilleur }
    }
  }
  return null
}

async function chercherDansMappings(nomVu, sourceIcs) {
  const clef = `${nomVu}|${sourceIcs}`
  if (cacheMappings[clef] !== undefined) return cacheMappings[clef]
  const { data } = await supabase.from('club_mappings_internationaux')
    .select('id, statut, club_id, pays_id, clubs(id, nom, nom_normalise, pays_id)')
    .eq('nom_vu', nomVu).eq('source_ics', sourceIcs).single()
  cacheMappings[clef] = data || null
  return data || null
}

async function ajouterEnPending(nomVu, sourceIcs) {
  const { data: existant } = await supabase.from('club_mappings_internationaux')
    .select('id, nb_occurrences').eq('nom_vu', nomVu).eq('source_ics', sourceIcs).single()
  if (existant) {
    await supabase.from('club_mappings_internationaux')
      .update({ nb_occurrences: existant.nb_occurrences + 1 }).eq('id', existant.id)
    return null
  }
  const { data: placeholder } = await supabase.from('clubs')
    .insert({ nom: nomVu, nom_normalise: normaliser(nomVu), type_placeholder: 'international_pending' })
    .select('id').single()
  await supabase.from('club_mappings_internationaux').insert({
    nom_vu: nomVu, nom_normalise: normaliser(nomVu),
    statut: 'pending', source_ics: sourceIcs,
    club_id: placeholder?.id || null, nb_occurrences: 1,
  })
  return placeholder
}

async function matcherClubInternational(nomEquipe, sourceIcs) {
  const nomNorm = normaliser(nomEquipe)
  const clubFFHB = await chercherDansClubs(nomNorm)
  if (clubFFHB) return { club: clubFFHB, source: 'ffhb', confiance: 'exact' }

  const mapping = await chercherDansMappings(nomEquipe, sourceIcs)
  if (mapping) {
    if (mapping.statut === 'mapped' && mapping.clubs)
      return { club: mapping.clubs, source: 'mapping', confiance: 'mapped' }
    if (mapping.statut === 'ignore') return null
    if (mapping.club_id)
      return { club: { id: mapping.club_id, nom: nomEquipe }, source: 'pending', confiance: 'pending' }
  }

  const placeholder = await ajouterEnPending(nomEquipe, sourceIcs)
  if (placeholder)
    return { club: { id: placeholder.id, nom: nomEquipe }, source: 'pending', confiance: 'pending' }
  return null
}

// Alias demandé par le script : on réutilise la logique internationale existante
async function matcherClub(nomEquipe) {
  return matcherClubInternational(nomEquipe, 'lnh_tv')
}

async function trouverMatchExistant(clubDomId, clubExtId, dateHeure) {
  if (!clubDomId || !clubExtId || !dateHeure) return null
  const date = new Date(dateHeure)
  const dateMin = new Date(date.getTime() - TV_FENETRE_HEURES * 3600000).toISOString()
  const dateMax = new Date(date.getTime() + TV_FENETRE_HEURES * 3600000).toISOString()
  const { data } = await supabase.from('matchs').select('id, diffuseur, source, gymnase, adresse_gymnase')
    .eq('club_domicile_id', clubDomId).eq('club_exterieur_id', clubExtId)
    .gte('date_heure', dateMin).lte('date_heure', dateMax).single()
  return data || null
}

async function upsertCompetition(ffhbId, nom, niveau, region = 'France') {
  const { data, error } = await supabase.from('competitions')
    .upsert({ ffhb_competition_id: ffhbId, nom, region, niveau, saison: '2025-2026' },
      { onConflict: 'ffhb_competition_id' }).select('id').single()
  if (error) { console.error(`  Erreur comp ${ffhbId}:`, error.message); return null }
  return data.id
}

async function scraperEquipePro(c, s, competitionId) {
  const url = `${BASE_URL}/c-${c}/s-${s}.ics`
  let events = []
  try {
    const raw = await ical.async.fromURL(url)
    events = Object.values(raw).filter(e => e.type === 'VEVENT')
  } catch { return { nbMatchs: 0, erreur: true } }
  if (events.length === 0) return { nbMatchs: 0, erreur: false }

  const comptage = {}
  for (const e of events) {
    const nom = e.summary?.split(' vs ')[0]?.trim()
    if (nom) comptage[nom] = (comptage[nom] || 0) + 1
  }
  const nomEquipe = Object.entries(comptage).sort((a, b) => b[1] - a[1])[0]?.[0]
  const nomNorm = normaliser(nomEquipe || '')

  let club = await chercherDansClubs(nomNorm)
  if (!club) {
    const { data: nouveau } = await supabase.from('clubs')
      .insert({ nom: nomEquipe || `Equipe s-${s}`, nom_normalise: nomNorm, type_placeholder: 'pro' })
      .select('id').single()
    if (!nouveau) return { nbMatchs: 0, erreur: true }
    cacheClubs[nomNorm] = nouveau; club = nouveau
  }

  await supabase.from('club_team_ids').upsert({
    club_id: club.id, competition_id: competitionId,
    ffhb_team_id: String(s), ffhb_competition_id: String(c),
  }, { onConflict: 'ffhb_team_id,ffhb_competition_id' })

  let nbMatchs = 0
  for (const event of events) {
    const parties = (event.summary || '').split(' vs ')
    if (parties.length !== 2) continue
    const nousEteDomicile = normaliser(parties[0].trim()).includes(nomNorm) ||
                            nomNorm.includes(normaliser(parties[0].trim()))
    const nomAdv = nousEteDomicile ? parties[1].trim() : parties[0].trim()
    const adversaire = await chercherDansClubs(normaliser(nomAdv))
    const clubDomId = nousEteDomicile ? club.id : adversaire?.id || null
    const clubExtId = nousEteDomicile ? adversaire?.id || null : club.id
    const statut = event.start && event.start > new Date() ? 'a_venir' : 'passe'
    await supabase.from('matchs').upsert({
      uid_ics: event.uid || null, competition_id: competitionId,
      club_domicile_id: clubDomId, club_exterieur_id: clubExtId,
      date_heure: event.start?.toISOString() || null,
      gymnase: event.location || null, adresse_gymnase: null, lat: null, lon: null,
      url_match: event.url || null, statut, source: 'ffhb',
      scraped_at: new Date().toISOString(),
    }, { onConflict: 'uid_ics', ignoreDuplicates: false })
    nbMatchs++
    await new Promise(r => setTimeout(r, 50))
  }
  return { nbMatchs, nomEquipe, confiance: 'exact' }
}

async function scraperEHF() {
  console.log('\n► EHF (Champions League, European League, Equipes nationales)')
  const competitionId = await upsertCompetition('ehf-2025-2026', 'Competitions EHF 2025-2026', 'ehf', 'Europe')
  if (!competitionId) return
  let events = []
  try {
    const raw = await ical.async.fromURL(EHF_URL)
    events = Object.values(raw).filter(e => e.type === 'VEVENT')
  } catch (err) { console.log(`  Erreur EHF: ${err.message}`); return }
  console.log(`  ${events.length} matchs trouves`)
  let nbInseres = 0
  for (const event of events) {
    const parties = (event.summary || '').split(' vs ')
    if (parties.length !== 2) continue
    const resultDom = await matcherClubInternational(parties[0].trim(), 'ehf')
    const resultExt = await matcherClubInternational(parties[1].trim(), 'ehf')
    const desc = (event.description || '').replace(/\\n/g, '\n')
    const lieu = desc.split('\n').map(l => l.trim()).filter(Boolean)[2] || null
    const statut = event.start && event.start > new Date() ? 'a_venir' : 'passe'
    await supabase.from('matchs').upsert({
      uid_ics: event.uid || null, competition_id: competitionId,
      club_domicile_id: resultDom?.club?.id || null,
      club_exterieur_id: resultExt?.club?.id || null,
      date_heure: event.start?.toISOString() || null,
      gymnase: lieu, adresse_gymnase: null, lat: null, lon: null,
      url_match: event.url || null, statut, source: 'ehf',
      scraped_at: new Date().toISOString(),
    }, { onConflict: 'uid_ics', ignoreDuplicates: false })
    const iD = resultDom?.confiance === 'exact' ? '✓' : resultDom?.confiance === 'mapped' ? '~' : '?'
    const iE = resultExt?.confiance === 'exact' ? '✓' : resultExt?.confiance === 'mapped' ? '~' : '?'
    console.log(`  ${iD} ${parties[0].trim()} vs ${iE} ${parties[1].trim()}`)
    nbInseres++
    await new Promise(r => setTimeout(r, 50))
  }
  console.log(`  -> ${nbInseres} matchs EHF traites`)
}

async function scraperTV() {
  console.log('\n► TV Sports (diffusions handball)')
  const competitionId = await upsertCompetition('tv-sports-handball', 'Diffusions TV Handball', 'tv', 'France')
  if (!competitionId) return
  let events = []
  try {
    const raw = await ical.async.fromURL(TV_URL)
    events = Object.values(raw).filter(e => e.type === 'VEVENT')
  } catch (err) { console.log(`  Erreur TV: ${err.message}`); return }
  console.log(`  ${events.length} diffusions trouvees`)
  let nbEnrichis = 0, nbNouveaux = 0
  for (const event of events) {
    const summary = event.summary || ''
    const diffuseurMatch = summary.match(/\(([^)]+)\)/)
    const diffuseur = diffuseurMatch ? diffuseurMatch[1] : null
    const cleanSummary = summary.replace(/🤾\s*/g, '').replace(/\s*\([^)]+\)/, '').trim()
    const sep = cleanSummary.includes(' vs ') ? ' vs ' : ' / '
    const parties = cleanSummary.split(sep)
    if (parties.length !== 2) continue
    const resultDom = await matcherClubInternational(parties[0].trim(), 'tv_sports')
    const resultExt = await matcherClubInternational(parties[1].trim(), 'tv_sports')
    const clubDomId = resultDom?.club?.id || null
    const clubExtId = resultExt?.club?.id || null
    const dateHeure = event.start?.toISOString() || null

    if (resultDom?.source === 'ffhb' && resultExt?.source === 'ffhb') {
      const matchExistant = await trouverMatchExistant(clubDomId, clubExtId, dateHeure)
      if (matchExistant) {
        await supabase.from('matchs').update({ diffuseur, scraped_at: new Date().toISOString() })
          .eq('id', matchExistant.id)
        console.log(`  📺 Enrichi: ${parties[0].trim()} vs ${parties[1].trim()} -> ${diffuseur}`)
        nbEnrichis++
        await new Promise(r => setTimeout(r, 50))
        continue
      }
    }

    const statut = event.start && event.start > new Date() ? 'a_venir' : 'passe'
    await supabase.from('matchs').upsert({
      uid_ics: event.uid || null, competition_id: competitionId,
      club_domicile_id: clubDomId, club_exterieur_id: clubExtId,
      date_heure: dateHeure, gymnase: null, adresse_gymnase: null, lat: null, lon: null,
      url_match: event.url || null, statut, diffuseur, source: 'tv_sports',
      scraped_at: new Date().toISOString(),
    }, { onConflict: 'uid_ics', ignoreDuplicates: false })
    console.log(`  📺 Nouveau: ${parties[0].trim()} vs ${parties[1].trim()} -> ${diffuseur || 'sans chaine'}`)
    nbNouveaux++
    await new Promise(r => setTimeout(r, 50))
  }
  console.log(`  -> ${nbEnrichis} enrichis | ${nbNouveaux} nouveaux`)
}

async function scraperLNH(competitionId) {
  console.log('\n► LNH TV (feed .ics)')
  if (!competitionId) return

  let events = []
  try {
    const raw = await ical.async.fromURL(LNH_TV_URL)
    events = Object.values(raw).filter(e => e.type === 'VEVENT')
  } catch (err) {
    console.log(`  Erreur LNH TV: ${err.message}`)
    return
  }

  console.log(`  ${events.length} évènements .ics trouvés`)

  let nbEnrichis = 0
  let nbNouveaux = 0

  for (const event of events) {
    const summary = event.summary || ''
    const partsTeams = summary.split(' // ')
    if (partsTeams.length < 2) continue

    const teamsPart = partsTeams[1].trim()
    const parties = teamsPart.split(/\s+-\s+/).map(t => t.trim()).filter(Boolean)
    if (parties.length !== 2) continue

    const teamDomName = parties[0]
    const teamExtName = parties[1]

    const desc = String(event.description || '').replace(/\\n/g, '\n')

    let diffuseur = null
    const mDiff = desc.match(/En direct sur\s+(.+)/i)
    if (mDiff) diffuseur = mDiff[1].split('\n')[0].trim()

    const dateHeure = event.start?.toISOString() || null
    const uid = event.uid || null
    if (!uid || !dateHeure) continue

    const locationRaw = event.location || null
    let gymnase = null
    let adresse_gymnase = null
    if (locationRaw) {
      const location = String(locationRaw).trim()
      if (location.includes(',')) {
        const [g, ...rest] = location.split(',').map(x => x.trim())
        gymnase = g || null
        adresse_gymnase = rest.length ? rest.join(', ') : null
      } else {
        gymnase = location
      }
    }

    const resultDom = await matcherClub(teamDomName)
    const resultExt = await matcherClub(teamExtName)
    const clubDomId = resultDom?.club?.id || null
    const clubExtId = resultExt?.club?.id || null
    if (!clubDomId || !clubExtId) continue

    const statut = event.start && event.start > new Date() ? 'a_venir' : 'passe'
    const scraped_at = new Date().toISOString()

    // Fusion ±3h (et enrichissement : gymnase seulement si null côté DB)
    if (resultDom?.source === 'ffhb' && resultExt?.source === 'ffhb') {
      const matchExistant = await trouverMatchExistant(clubDomId, clubExtId, dateHeure)
      if (matchExistant) {
        const patch = {
          diffuseur,
          scraped_at,
        }

        if ((matchExistant.gymnase === null || matchExistant.gymnase === undefined) && gymnase) {
          patch.gymnase = gymnase
          if (adresse_gymnase) patch.adresse_gymnase = adresse_gymnase
        }

        await supabase.from('matchs').update(patch).eq('id', matchExistant.id)
        console.log(`  📺 Enrichi: ${teamDomName} vs ${teamExtName} -> ${diffuseur || 'sans chaine'}`)
        nbEnrichis++
        await new Promise(r => setTimeout(r, 50))
        continue
      }
    }

    await supabase.from('matchs').upsert({
      uid_ics: uid,
      competition_id: competitionId,
      club_domicile_id: clubDomId,
      club_exterieur_id: clubExtId,
      date_heure: dateHeure,
      gymnase,
      adresse_gymnase,
      lat: null,
      lon: null,
      url_match: event.url || null,
      statut,
      diffuseur,
      source: 'lnh_tv',
      scraped_at,
    }, { onConflict: 'uid_ics', ignoreDuplicates: false })

    console.log(`  📺 Nouveau: ${teamDomName} vs ${teamExtName} -> ${diffuseur || 'sans chaine'}`)
    nbNouveaux++
    await new Promise(r => setTimeout(r, 50))
  }

  console.log(`  -> ${nbEnrichis} enrichis | ${nbNouveaux} nouveaux`)
}

async function run() {
  console.log('===================================================')
  console.log('  05-import-pro.js v2')
  console.log('  Pro + EHF + TV | 3 couches | fusion +/-3h')
  console.log('===================================================\n')

  let totalMatchsPro = 0, totalEquipesPro = 0

  for (const comp of COMPETITIONS_PRO) {
    const label = `${comp.competition} ${comp.genre === 'M' ? 'Masculine' : 'Feminine'}`
    console.log(`\n► ${label} (c-${comp.c}) — ${comp.equipes.length} equipes`)
    const competitionId = await upsertCompetition(comp.c, label, comp.niveau)
    if (!competitionId) continue
    for (const s of comp.equipes) {
      const result = await scraperEquipePro(comp.c, s, competitionId)
      if (result.erreur) console.log(`  x s-${s} — erreur`)
      else if (result.nbMatchs === 0) console.log(`  . s-${s} — 0 matchs`)
      else {
        console.log(`  ✓ s-${s} — ${result.nomEquipe} — ${result.nbMatchs} matchs`)
        totalMatchsPro += result.nbMatchs; totalEquipesPro++
      }
      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }

  await scraperEHF()
  await scraperTV()

  // Même compétition que le scraper TV (handball diffusé en direct)
  const compTV = { id: await upsertCompetition('tv-sports-handball', 'Diffusions TV Handball', 'tv', 'France') }
  await scraperLNH(compTV.id)

  const { count: nbPending } = await supabase
    .from('club_mappings_internationaux').select('*', { count: 'exact', head: true })
    .eq('statut', 'pending')

  console.log('\n===================================================')
  console.log('RESUME FINAL')
  console.log('===================================================')
  console.log(`Equipes pro traitees  : ${totalEquipesPro}`)
  console.log(`Matchs pro inseres    : ${totalMatchsPro}`)
  console.log(`Clubs en attente      : ${nbPending || 0} -> /admin/clubs-internationaux`)
  console.log('===================================================')
  console.log('\nImport termine !')
}

run()
