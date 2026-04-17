import seedData from './seed/data.json';

const TARGET_LEAGUES_FOR_SHIELDS = ['Serie A', 'Brasileirão Série A'];

const CLUB_IMAGE_ALIASES: Record<string, string[]> = {
  athleticoparanaense: ['athleticopr'],
  interdemilano: ['internazionalemilano', 'inter'],
  saopaulo: ['saopaulo'],
  vascodagama: ['vasco'],
  verona: ['hellasverona'],
};

const normalizeKey = (value: string): string => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
};

const stripImageNameNoise = (value: string): string => {
  return value
    .replace(/\.[^/.]+$/, '')
    .replace(/^(thumbnail_|small_|medium_|large_)/i, '')
    .replace(/_[a-f0-9]{10}$/i, '');
};

const buildUploadImageIndex = (files: any[]): Map<string, number> => {
  const index = new Map<string, number>();

  for (const file of files) {
    const candidates = [file?.name, file?.hash]
      .filter(Boolean)
      .map((candidate: string) => normalizeKey(stripImageNameNoise(candidate)));

    for (const key of candidates) {
      if (!key || index.has(key)) continue;
      index.set(key, file.id);
    }
  }

  return index;
};

const getShieldFileIdForClub = (clubName: string, imageIndex: Map<string, number>): number | null => {
  const clubKey = normalizeKey(clubName);
  const aliasKeys = CLUB_IMAGE_ALIASES[clubKey] ?? [];
  const keysToTry = [clubKey, ...aliasKeys.map(normalizeKey)];

  for (const key of keysToTry) {
    const fileId = imageIndex.get(key);
    if (fileId) return fileId;
  }

  return null;
};

const attachMissingClubShields = async (strapi: any): Promise<void> => {
  const uploadFiles = await strapi.db.query('plugin::upload.file').findMany({
    select: ['id', 'name', 'hash'],
  });

  if (!uploadFiles.length) {
    strapi.log.info('[SEED] 🖼️  Nenhum arquivo encontrado no Upload para vincular escudos.');
    return;
  }

  const imageIndex = buildUploadImageIndex(uploadFiles);

  const clubs = await strapi.db.query('api::club.club').findMany({
    where: {
      league: {
        name: {
          $in: TARGET_LEAGUES_FOR_SHIELDS,
        },
      },
    },
    populate: {
      league: true,
      shield: {
        select: ['id'],
      },
    },
  });

  let attachedCount = 0;
  let skippedWithShieldCount = 0;
  let missingImageCount = 0;

  for (const club of clubs) {
    if (club.shield?.id) {
      skippedWithShieldCount++;
      continue;
    }

    const shieldFileId = getShieldFileIdForClub(club.name, imageIndex);

    if (!shieldFileId) {
      missingImageCount++;
      strapi.log.warn(`[SEED] ⚠️  Escudo não encontrado para clube: "${club.name}"`);
      continue;
    }

    await strapi.entityService.update('api::club.club', club.id, {
      data: {
        shield: shieldFileId,
      },
    });

    attachedCount++;
    strapi.log.info(`[SEED] 🖼️  Escudo vinculado ao clube "${club.name}" (arquivo id=${shieldFileId})`);
  }

  strapi.log.info(
    `[SEED] 🧩 Vínculo de escudos concluído — vinculados: ${attachedCount}, já tinham escudo: ${skippedWithShieldCount}, sem imagem correspondente: ${missingImageCount}`
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Gera um ShortName de 3 letras a partir do nome do clube/seleção
// Ex: "Alavés" → "ALA", "Borussia M'gladbach" → "BOR"
// ─────────────────────────────────────────────────────────────────────────────
const generateShortName = (name: string): string => {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toUpperCase()
    .replace(/[^A-Z]/g, '');         // mantém só letras

  return normalized.slice(0, 3).padEnd(3, 'X');
};

export default {
  register() {},

  async bootstrap({ strapi }) {
    // ── GUARD ───────────────────────────────────────────────────────────────
    // Por padrão o seed SÓ roda se o banco estiver vazio.
    // Para forçar o wipe+reseed (apaga TUDO, inclusive imagens!):
    //   SEED_DATA=force npm run dev
    const forceReseed = process.env.SEED_DATA === 'force';

    if (!forceReseed) {
      const existingCount = await strapi.db
        .query('api::continent.continent')
        .count({});

      if (existingCount > 0) {
        strapi.log.info(
          `[SEED] ⏭️  Banco já possui ${existingCount} continente(s). Seed ignorado.`
        );
        await attachMissingClubShields(strapi);
        strapi.log.info(
          '[SEED]    Para recriar tudo: SEED_DATA=force npm run dev  ⚠️  apaga imagens!'
        );
        return;
      }
    }

    // ── WIPE (só chega aqui se banco vazio OU SEED_DATA=force) ──────────────
    if (forceReseed) {
      strapi.log.warn('[SEED] ⚠️  SEED_DATA=force detectado — apagando TODOS os dados e imagens de liga/clube...');
    }

    strapi.log.info('[SEED] 🗑️  Limpando banco de dados...');

    await strapi.db.query('api::club.club').deleteMany({});
    strapi.log.info('[SEED]   ✓ Clubes removidos');

    await strapi.db.query('api::league.league').deleteMany({});
    strapi.log.info('[SEED]   ✓ Ligas removidas');

    await strapi.db.query('api::continent.continent').deleteMany({});
    strapi.log.info('[SEED]   ✓ Continentes removidos');

    // ── SEED ────────────────────────────────────────────────────────────────
    strapi.log.info('[SEED] 🌱 Iniciando semeadura...');

    let totalClubes = 0;

    for (const continentData of seedData) {
      strapi.log.info(`[SEED] 🌍 Criando continente: "${continentData.name}"`);

      // Cria continente via Document Service (padrão Strapi 5)
      let continent: any;
      try {
        continent = await (strapi as any)
          .documents('api::continent.continent')
          .create({
            data: { name: continentData.name },
            status: 'published',
          });
        strapi.log.info(`[SEED]   → Continente OK  documentId=${continent.documentId}`);
      } catch (err: any) {
        strapi.log.error(`[SEED]   ✗ Falha ao criar continente "${continentData.name}": ${err?.message}`);
        if (err?.details) console.error('[SEED]   Detalhes:', JSON.stringify(err.details, null, 2));
        throw err;
      }

      for (const leagueData of continentData.leagues) {
        strapi.log.info(`[SEED]   🏆 Criando liga: "${leagueData.name}"`);

        // Cria liga e vincula ao continente via documentId
        let league: any;
        try {
          league = await (strapi as any)
            .documents('api::league.league')
            .create({
              data: {
                name: leagueData.name,
                is_national_team: leagueData.is_national,
                // Strapi 5: relação manyToOne via connect + documentId
                continent: {
                  connect: [{ documentId: continent.documentId }],
                },
              },
              status: 'published',
            });
          strapi.log.info(`[SEED]     → Liga OK  documentId=${league.documentId}`);
        } catch (err: any) {
          strapi.log.error(`[SEED]     ✗ Falha ao criar liga "${leagueData.name}": ${err?.message}`);
          if (err?.details) console.error('[SEED]     Detalhes:', JSON.stringify(err.details, null, 2));
          throw err;
        }

        // Cria cada clube e vincula à liga via documentId
        for (const clubName of leagueData.clubs) {
          try {
            const club = await (strapi as any)
              .documents('api::club.club')
              .create({
                data: {
                  name: clubName,
                  ShortName: generateShortName(clubName),
                  // Strapi 5: relação manyToOne via connect + documentId
                  league: {
                    connect: [{ documentId: league.documentId }],
                  },
                },
                status: 'published',
              });

            totalClubes++;
            console.log(
              `[SEED]       ✓ ${clubName} (ShortName=${generateShortName(clubName)}, documentId=${club.documentId})`
            );
          } catch (err: any) {
            strapi.log.error(
              `[SEED]       ✗ Falha ao criar clube "${clubName}" na liga "${leagueData.name}": ${err?.message}`
            );
            if (err?.details) {
              console.error('[SEED]       Detalhes de validação:', JSON.stringify(err.details, null, 2));
            }
            throw err;
          }
        }

        strapi.log.info(
          `[SEED]     ✅ Liga "${leagueData.name}" — ${leagueData.clubs.length} clube(s) inserido(s)`
        );
      }
    }

    await attachMissingClubShields(strapi);

    strapi.log.info(`[SEED] 🎉 Seed concluído! Total de clubes/seleções inseridos: ${totalClubes}`);
  },
};