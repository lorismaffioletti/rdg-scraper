// 01-import-clubs.js
// Lit le fichier clubs.csv et importe tous les clubs dans Supabase

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ─── Fonction de normalisation ────────────────────────────────────────────────
// Transforme "JOINVILLE HBA" en "joinville hba"
// Transforme "Héricourt H.B" en "hericourt hb"
// Ça permet de comparer des noms même s'ils sont écrits différemment
function normaliser(texte) {
  if (!texte) return ''
  return texte
    .toLowerCase()
    .normalize('NFD')                    // décompose les accents (é → e + ´)
    .replace(/[\u0300-\u036f]/g, '')     // supprime les accents
    .replace(/[^a-z0-9\s]/g, ' ')       // remplace ponctuation par espace
    .replace(/\s+/g, ' ')               // supprime les espaces multiples
    .trim()                             // supprime les espaces en début/fin
}

// ─── Lecture du CSV ───────────────────────────────────────────────────────────
function lireCSV(cheminFichier) {
  const contenu = fs.readFileSync(cheminFichier, 'utf-8')
  const lignes = contenu.split('\n')
  
  // La première ligne contient les noms de colonnes
  const entetes = lignes[0].split(',').map(e => e.trim().replace(/"/g, ''))
  console.log('Colonnes détectées :', entetes)
  
  const clubs = []
  
  for (let i = 1; i < lignes.length; i++) {
    const ligne = lignes[i]
    if (!ligne.trim()) continue // ignore les lignes vides
    
    // Découpe la ligne en valeurs
    const valeurs = ligne.split(',').map(v => v.trim().replace(/"/g, ''))
    
    // Crée un objet avec les noms de colonnes
    const club = {}
    entetes.forEach((entete, index) => {
      club[entete] = valeurs[index] || null
    })
    
    // On ne garde que les clubs qui ont au moins un nom
    if (club.name && club.name.trim()) {
      clubs.push(club)
    }
  }
  
  return clubs
}

// ─── Import dans Supabase ─────────────────────────────────────────────────────
async function importerClubs() {
  console.log('\nLecture du fichier clubs.csv...')
  const clubs = lireCSV('clubs.csv')
  console.log(`→ ${clubs.length} clubs trouvés dans le CSV\n`)

  let importes = 0
  let erreurs = 0

  for (const club of clubs) {
    const { error } = await supabase
      .from('clubs')
      .upsert({
        nom: club.name,
        nom_normalise: normaliser(club.name),
        logo_url: club.logo_url || null,
        adresse: club.address || null,
      }, {
        onConflict: 'nom_normalise'  // si le club existe déjà, on le met à jour
      })

    if (error) {
      console.log(`✗ Erreur pour "${club.name}" :`, error.message)
      erreurs++
    } else {
      importes++
      // Affiche la progression tous les 100 clubs
      if (importes % 100 === 0) {
        console.log(`  ${importes}/${clubs.length} clubs importés...`)
      }
    }
  }

  console.log('\n─────────────────────────────────')
  console.log(`✓ ${importes} clubs importés avec succès`)
  if (erreurs > 0) {
    console.log(`✗ ${erreurs} erreurs`)
  }
  console.log('─────────────────────────────────\n')
}

importerClubs()