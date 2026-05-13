// 00-test-connexion.js
// Ce script vérifie uniquement que la connexion à Supabase fonctionne

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// Charge les variables du fichier .env
dotenv.config()

// Crée la connexion à Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

console.log('Tentative de connexion à Supabase...')
console.log('URL :', process.env.SUPABASE_URL)

// Teste la connexion en demandant la version de la base
const { data, error } = await supabase
  .from('_prisma_migrations') // table système qui existe toujours
  .select('*')
  .limit(1)

  if (error && error.message.includes('schema cache')) {
    // Base vide = connexion OK
    console.log('✓ Connexion établie avec succès !')
    console.log('  (La base est vide pour l\'instant, c\'est normal)')
  } else if (error) {
    console.log('✗ Erreur de connexion :')
    console.log('  ', error.message)
  } else {
    console.log('✓ Connexion établie avec succès !')
  }