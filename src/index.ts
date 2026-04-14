export default {
  register() {},

  async bootstrap({ strapi }) {
    // Executa após o Strapi estar totalmente "pronto"
    process.nextTick(async () => {
      const generateShortName = (name: string) => {
        const cleaned = name.toUpperCase().replace(/\s/g, '').replace(/[^A-Z]/g, '');
        return cleaned.substring(0, 3);
      };

      const continentsData = [
        {
          name: "Europe",
          leagues: [
            {
              name: "Premier League",
              is_national: false,
              clubs: ["Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton", "Chelsea", "Crystal Palace", "Everton", "Fulham", "Ipswich Town", "Leicester City", "Liverpool", "Man City", "Man Utd", "Newcastle", "Nottingham Forest", "Southampton", "Tottenham", "West Ham", "Wolves"]
            },
            {
              name: "La Liga",
              is_national: false,
              clubs: ["Alavés", "Athletic Bilbao", "Atlético Madrid", "Barcelona", "Celta Vigo", "Espanyol", "Getafe", "Girona", "Las Palmas", "Leganés", "Mallorca", "Osasuna", "Rayo Vallecano", "Real Betis", "Real Madrid", "Real Sociedad", "Sevilla", "Valencia", "Valladolid", "Villarreal"]
            },
            {
              name: "Serie A",
              is_national: false,
              clubs: ["Atalanta", "Bologna", "Cagliari", "Como", "Empoli", "Fiorentina", "Genoa", "Inter Milan", "Juventus", "Lazio", "Lecce", "Milan", "Monza", "Napoli", "Parma", "Roma", "Torino", "Udinese", "Venezia", "Verona"]
            },
            {
              name: "Bundesliga",
              is_national: false,
              clubs: ["Augsburg", "Bayer Leverkusen", "Bayern Munich", "Bochum", "Borussia Dortmund", "Borussia M'gladbach", "Eintracht Frankfurt", "Freiburg", "Heidenheim", "Hoffenheim", "Holstein Kiel", "Mainz 05", "RB Leipzig", "St. Pauli", "Stuttgart", "Union Berlin", "Werder Bremen", "Wolfsburg"]
            },
            {
              name: "Ligue 1",
              is_national: false,
              clubs: ["Angers", "Auxerre", "Brest", "Le Havre", "Lens", "Lille", "Lorient", "Lyon", "Marseille", "Monaco", "Montpellier", "Nantes", "Nice", "PSG", "Reims", "Rennes", "Saint-Étienne", "Strasbourg", "Toulouse"]
            },
            {
              name: "Seleções Europeias (UEFA)",
              is_national: true,
              clubs: ["Albânia", "Alemanha", "Andorra", "Armênia", "Áustria", "Azerbaijão", "Bélgica", "Bielorrússia", "Bósnia e Herzegovina", "Bulgária", "Cazaquistão", "Chipre", "Croácia", "Dinamarca", "Escócia", "Eslováquia", "Eslovênia", "Espanha", "Estônia", "Finlândia", "França", "Geórgia", "Gibraltar", "Grécia", "Holanda", "Hungria", "Ilhas Faroé", "Inglaterra", "Irlanda", "Irlanda do Norte", "Islândia", "Israel", "Itália", "Kosovo", "Letônia", "Liechtenstein", "Lituânia", "Luxemburgo", "Macedônia do Norte", "Malta", "Moldávia", "Montenegro", "Noruega", "País de Gales", "Polônia", "Portugal", "República Tcheca", "Romênia", "San Marino", "Sérvia", "Suécia", "Suíça", "Turquia", "Ucrânia"]
            }
          ]
        }
      ];

      try {
        console.log('--- 🧹 Limpando Banco ---');
        await strapi.db.query('api::club.club').deleteMany({});
        await strapi.db.query('api::league.league').deleteMany({});
        await strapi.db.query('api::continent.continent').deleteMany({});

        for (const contData of continentsData) {
          const continent = await strapi.entityService.create('api::continent.continent', {
            data: { name: contData.name, publishedAt: new Date() }
          });

          for (const leagueData of contData.leagues) {
            const league = await strapi.entityService.create('api::league.league', {
              data: { 
                name: leagueData.name, 
                is_national_team: leagueData.is_national,
                continent: continent.id,
                publishedAt: new Date() 
              }
            });

            console.log(`--- ⚽ Semeando ${leagueData.name} ---`);

            for (const clubName of leagueData.clubs) {
              await strapi.entityService.create('api::club.club', {
                data: { 
                  name: clubName, 
                  ShortName: generateShortName(clubName), // PascalCase como no print
                  league: league.id, // Vínculo explícito
                  publishedAt: new Date() 
                }
              });
            }
          }
        }
        console.log('--- 🚀 SEED COMPLETO ---');
      } catch (err) {
        console.error('--- ❌ ERRO NO SEED ---', err);
      }
    });
  },
};