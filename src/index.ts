import fs from 'fs';
import path from 'path';
import seedData from './seed/data.json';

const FOLDER_MAP: Record<string, string> = {
  bundesliga: 'bundesleague',
  seriea: 'serieaitalia',
  ligue1: 'ligue1france',
  brasileiraoseriea: 'brasileirao',
};

const BASE_SHIELDS_DIR = path.join(process.cwd(), 'src/data/shields');
const BOOTSTRAP_CLOUDINARY_UPLOAD_ENABLED = process.env.BOOTSTRAP_CLOUDINARY_UPLOAD === 'true';

let cloudinaryUploadsTemporarilyDisabled = false;

const CLUB_IMAGE_ALIASES: Record<string, string[]> = {
  athleticoparanaense: ['athleticopr'],
  interdemilano: ['internazionalemilano', 'inter'],
  saopaulo: ['saopaulo'],
  vascodagama: ['vasco'],
  verona: ['hellasverona'],
};

const LEAGUE_IMAGE_ALIASES: Record<string, string[]> = {
  seriea: ['serieaitalia'],
  brasileiraoseriea: ['brasileirao'],
  selecoeseuropeiasuefa: ['uefalogo', 'uefa'],
  selecoessulamericanasconmebol: ['conmebol'],
};

const CONTINENT_IMAGE_ALIASES: Record<string, string[]> = {
  europe: ['europa'],
  southamerica: ['americasul', 'sudamerica'],
};

const normalizeKey = (value: string): string => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
};

const safeNormalizeKey = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return normalizeKey(value);
};

const stripImageNameNoise = (value: string): string => {
  return value
    // remove índices/prefixos comuns: "1._", "01-", "2__", etc.
    .replace(/^\d+[._-]*/i, '')
    // remove sufixos de extensão encadeada: ".svg.png", ".jpeg", etc.
    .replace(/(\.[a-z0-9]+)+$/i, '')
    .replace(/^(thumbnail_|small_|medium_|large_)/i, '')
    // remove rótulos muito comuns em nome de arquivo
    .replace(/(^|[_\-.])(logo|escudo|shield)($|[_\-.])/gi, '_')
    .replace(/(^|[_\-.])(fc|cf)($|[_\-.])/gi, '_')
    .replace(/[_\-.]{2,}/g, '_')
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

  // Fallback por similaridade para lidar com nomes como
  // "1._FC_Union_Berlin_Logo.svg.png".
  const candidates = Array.from(imageIndex.entries());
  for (const key of keysToTry) {
    if (!key || key.length < 4) continue;
    const similar = candidates.find(([fileKey]) => fileKey.includes(key) || key.includes(fileKey));
    if (similar) return similar[1];
  }

  return null;
};

const findFileIdByKeys = (keys: string[], imageIndex: Map<string, number>): number | null => {
  const normalized = keys
    .map((key) => normalizeKey(key))
    .filter((key) => key.length > 0);

  for (const key of normalized) {
    const fileId = imageIndex.get(key);
    if (fileId) return fileId;
  }

  // Fallback por similaridade para cobrir diferenças pequenas de nome.
  const candidates = Array.from(imageIndex.entries());
  for (const key of normalized) {
    if (key.length < 4) continue;
    const similar = candidates.find(([fileKey]) => fileKey.includes(key) || key.includes(fileKey));
    if (similar) return similar[1];
  }

  return null;
};

const getLogoFileIdForLeague = (leagueName: string, imageIndex: Map<string, number>): number | null => {
  const leagueKey = normalizeKey(leagueName);
  const folderAlias = FOLDER_MAP[leagueKey];
  const aliases = LEAGUE_IMAGE_ALIASES[leagueKey] ?? [];
  const keysToTry = [leagueKey, folderAlias ?? '', ...aliases].filter(Boolean);
  return findFileIdByKeys(keysToTry, imageIndex);
};

const getLogoFileIdForContinent = (continentName: string, imageIndex: Map<string, number>): number | null => {
  const continentKey = normalizeKey(continentName);
  const aliases = CONTINENT_IMAGE_ALIASES[continentKey] ?? [];
  const keysToTry = [continentKey, ...aliases];
  return findFileIdByKeys(keysToTry, imageIndex);
};

const hasMedia = (media: any): boolean => {
  if (!media) return false;
  if (Array.isArray(media)) return media.length > 0;
  return Boolean(media.id || media.documentId);
};

const uploadToCloudinary = async (
  strapi: any,
  filePath: string | undefined,
  refId: number,
  ref: string,
  field: string
): Promise<boolean> => {
  if (!filePath || typeof filePath !== 'string') {
    strapi.log.warn(`[SEED] ⚠️  Caminho de arquivo inválido para upload (${ref}.${field} refId=${refId}).`);
    return false;
  }

  if (!fs.existsSync(filePath)) {
    strapi.log.warn(`[SEED] ⚠️  Arquivo não encontrado para upload: ${filePath}`);
    return false;
  }

  const fileStat = fs.statSync(filePath);

  try {
    await strapi.plugins.upload.services.upload.upload({
      data: {
        refId: String(refId),
        ref,
        field,
      },
      files: {
        filepath: filePath,
        originalFilename: path.basename(filePath),
        mimetype: 'image/png',
        size: fileStat.size,
      },
    });
    return true;
  } catch (err: any) {
    const errorMessage = String(err?.message ?? 'Erro desconhecido no upload');

    if (errorMessage.includes('Invalid Signature')) {
      cloudinaryUploadsTemporarilyDisabled = true;
      strapi.log.error(
        '[SEED] ✗ Cloudinary retornou Invalid Signature. Desabilitando uploads no bootstrap para evitar crash loop nesta inicialização.'
      );
    }

    strapi.log.error(
      `[SEED] ✗ Falha no upload Cloudinary (${ref}.${field} refId=${refId} file=${filePath}): ${errorMessage}`
    );
    return false;
  }
};

const resolveLeagueLogoPath = (leagueDir: string, leagueName: string, folderName: string): string | null => {
  const candidates = [
    path.join(leagueDir, `${safeNormalizeKey(leagueName)}.png`),
    path.join(leagueDir, `${folderName}.png`),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const attachMissingImages = async (strapi: any): Promise<void> => {
  if (!BOOTSTRAP_CLOUDINARY_UPLOAD_ENABLED) {
    strapi.log.info(
      '[SEED] ⏭️  Upload bootstrap para Cloudinary desativado (defina BOOTSTRAP_CLOUDINARY_UPLOAD=true para habilitar).'
    );
    return;
  }

  strapi.log.info('[SEED] 📤 Verificando uploads para Cloudinary...');

  if (!fs.existsSync(BASE_SHIELDS_DIR)) {
    strapi.log.warn(`[SEED] ⚠️  Pasta base de escudos não encontrada: ${BASE_SHIELDS_DIR}`);
    return;
  }

  let continentsUploaded = 0;
  let leaguesUploaded = 0;
  let clubsUploaded = 0;

  const continents = await (strapi as any).documents('api::continent.continent').findMany({
    populate: ['logo'],
  });

  for (const continent of continents) {
    if (cloudinaryUploadsTemporarilyDisabled) break;
    if (hasMedia(continent.logo)) continue;
    if (!continent.id) continue;
    const continentKey = safeNormalizeKey(continent.name);
    if (!continentKey) {
      strapi.log.warn(`[SEED] ⚠️  Continente sem nome válido, pulando upload (id=${continent.id}).`);
      continue;
    }

    const continentPath = path.join(
      BASE_SHIELDS_DIR,
      'continents',
      `${continentKey}.png`
    );

    if (!fs.existsSync(continentPath)) continue;

    const uploaded = await uploadToCloudinary(
      strapi,
      continentPath,
      continent.id,
      'api::continent.continent',
      'logo'
    );

    if (uploaded) {
      continentsUploaded++;
      strapi.log.info(`[SEED] ✅ Continente atualizado com logo: ${continent.name}`);
    }
  }

  const leagues = await (strapi as any).documents('api::league.league').findMany({
    populate: ['logo'],
  });

  for (const league of leagues) {
    if (cloudinaryUploadsTemporarilyDisabled) break;
    if (!league.id) continue;

    const normalizedLeagueName = safeNormalizeKey(league.name);
    if (!normalizedLeagueName) {
      strapi.log.warn(`[SEED] ⚠️  Liga sem nome válido, pulando upload (id=${league.id}).`);
      continue;
    }

    const folderName = FOLDER_MAP[normalizedLeagueName] || normalizedLeagueName;
    const leagueDir = path.join(BASE_SHIELDS_DIR, folderName);

    if (!fs.existsSync(leagueDir)) continue;

    if (!hasMedia(league.logo)) {
      const leagueLogoPath = resolveLeagueLogoPath(leagueDir, league.name, folderName);

      if (leagueLogoPath) {
        const uploaded = await uploadToCloudinary(
          strapi,
          leagueLogoPath,
          league.id,
          'api::league.league',
          'logo'
        );

        if (uploaded) {
          leaguesUploaded++;
          strapi.log.info(`[SEED] ✅ Liga atualizada com logo: ${league.name}`);
        }
      }
    }

    const clubs = await (strapi as any).documents('api::club.club').findMany({
      filters: {
        league: {
          documentId: {
            $eq: league.documentId ?? '',
          },
        },
      },
      populate: ['shield'],
    });

    const folderFiles = fs
      .readdirSync(leagueDir)
      .filter((fileName) => fileName.toLowerCase().endsWith('.png'));

    for (const club of clubs) {
      if (cloudinaryUploadsTemporarilyDisabled) break;
      if (hasMedia(club.shield)) continue;
      if (!club.id) continue;

      const clubKey = safeNormalizeKey(club.name);
      if (!clubKey) continue;

      const matchedFile = folderFiles.find((fileName) => {
        const fileKey = normalizeKey(stripImageNameNoise(fileName));
        return fileKey.includes(clubKey);
      });

      if (!matchedFile) continue;

      const uploaded = await uploadToCloudinary(
        strapi,
        path.join(leagueDir, matchedFile),
        club.id,
        'api::club.club',
        'shield'
      );

      if (uploaded) {
        clubsUploaded++;
        strapi.log.info(`[SEED] ✅ Clube atualizado com escudo: ${club.name}`);
      }
    }
  }

  strapi.log.info(
    `[SEED] ☁️ Uploads Cloudinary concluídos — continentes: ${continentsUploaded}, ligas: ${leaguesUploaded}, clubes: ${clubsUploaded}`
  );
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
    populate: {
      league: true,
      shield: {
        select: ['id'],
      },
    },
  });

  const leagues = await strapi.db.query('api::league.league').findMany({
    populate: {
      logo: {
        select: ['id'],
      },
    },
  });

  const continents = await strapi.db.query('api::continent.continent').findMany({
    populate: {
      logo: {
        select: ['id'],
      },
    },
  });

  let attachedCount = 0;
  let skippedWithShieldCount = 0;
  let missingImageCount = 0;
  let leaguesAttachedCount = 0;
  let leaguesMissingImageCount = 0;
  let continentsAttachedCount = 0;
  let continentsMissingImageCount = 0;

  for (const continent of continents) {
    if (continent.logo?.id) continue;

    const logoFileId = getLogoFileIdForContinent(continent.name, imageIndex);

    if (!logoFileId) {
      continentsMissingImageCount++;
      strapi.log.warn(`[SEED] ⚠️  Logo não encontrado para continente: "${continent.name}"`);
      continue;
    }

    await strapi.entityService.update('api::continent.continent', continent.id, {
      data: {
        logo: logoFileId,
      },
    });

    continentsAttachedCount++;
    strapi.log.info(`[SEED] 🌍 Logo vinculado ao continente "${continent.name}" (arquivo id=${logoFileId})`);
  }

  for (const league of leagues) {
    if (league.logo?.id) continue;

    const logoFileId = getLogoFileIdForLeague(league.name, imageIndex);

    if (!logoFileId) {
      leaguesMissingImageCount++;
      strapi.log.warn(`[SEED] ⚠️  Logo não encontrado para liga: "${league.name}"`);
      continue;
    }

    await strapi.entityService.update('api::league.league', league.id, {
      data: {
        logo: logoFileId,
      },
    });

    leaguesAttachedCount++;
    strapi.log.info(`[SEED] 🏆 Logo vinculado à liga "${league.name}" (arquivo id=${logoFileId})`);
  }

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
    `[SEED] 🧩 Vínculo concluído — continentes vinculados: ${continentsAttachedCount}, continentes sem imagem: ${continentsMissingImageCount}, ligas vinculadas: ${leaguesAttachedCount}, ligas sem imagem: ${leaguesMissingImageCount}, clubes vinculados: ${attachedCount}, clubes já tinham escudo: ${skippedWithShieldCount}, clubes sem imagem correspondente: ${missingImageCount}`
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
        await attachMissingImages(strapi);
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

    await attachMissingImages(strapi);
    await attachMissingClubShields(strapi);

    strapi.log.info(`[SEED] 🎉 Seed concluído! Total de clubes/seleções inseridos: ${totalClubes}`);
  },
};