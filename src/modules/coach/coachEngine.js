/* src/modules/coach/coachEngine.js */
import { coachStore } from './coachStore.js';
import { i18n } from './i18n.js';

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function addDaysISO(startISO, daysToAdd) {
    const d = new Date(`${startISO}T00:00:00`);
    d.setDate(d.getDate() + daysToAdd);
    return d.toISOString().slice(0, 10);
}

function slugify(input) {
    return String(input || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'skill';
}

function mkI18n(en, es, fr) {
    const safe = (v) => (v == null ? '' : String(v));
    const base = safe(en);
    return {
        en: base,
        es: safe(es ?? base),
        fr: safe(fr ?? base)
    };
}

function defaultSource(source_ref = 'generated') {
    return {
        source_type: 'generated',
        source_ref,
        last_verified_at: null,
        confidence_score: 60
    };
}

function clamp(num, min, max) {
    return Math.min(max, Math.max(min, num));
}

function buildResource({ kind, title_i18n, url, source_ref }) {
    return {
        kind,
        title_i18n,
        url: url || null,
        why_i18n: mkI18n('Shown to reinforce a weak spot.', 'Se muestra para reforzar un punto débil.', 'Affiché pour renforcer un point faible.'),
        fixes_i18n: mkI18n('Targets the most common mistake for this concept.', 'Ataca el error más común de este concepto.', 'Cible l’erreur la plus fréquente pour ce concept.'),
        source_metadata: defaultSource(source_ref || url || `generated:${kind}`),
        content_version: 1
    };
}

function buildQuiz({ id, concept_id, variant_id, difficulty_1to5, scenario_i18n, decision_prompt_i18n, options_i18n, correct_index, explain_i18n, trap_i18n, hint_i18n, tags = [], resources = null }) {
    return {
        id,
        exam_type: 'scenario_mcq',
        concept_id,
        variant_id,
        difficulty_1to5,
        tags,
        scenario_i18n,
        decision_prompt_i18n,
        options_i18n,
        correct_index,
        explain_i18n,
        trap_i18n,
        hint_i18n: hint_i18n || mkI18n('Focus on the constraint.', 'Enfócate en la restricción.', 'Focalisez-vous sur la contrainte.'),
        action_practice_i18n: mkI18n('Do a 20–30 min practice block focused on today’s constraint.', 'Haz un bloque de práctica de 20–30 min centrado en la restricción de hoy.', "Faites un bloc de pratique de 20–30 min centré sur la contrainte du jour."),
        mini_challenge_i18n: mkI18n('Write 1 sentence that states the constraint and the chosen option.', 'Escribe 1 frase con la restricción y la opción elegida.', 'Écrivez 1 phrase avec la contrainte et le choix.'),
        resources,
        source_metadata: defaultSource(`generated:${concept_id}:${variant_id}`),
        content_version: 1
    };
}

function scheduleSessions({ skillId, modules, startDateISO }) {
    const sessions = [];
    const modRoundRobin = modules.map(m => ({ module_id: m.id, concepts: m.concept_ids }));
    for (let day = 1; day <= 30; day += 1) {
        const mod = modRoundRobin[(day - 1) % modRoundRobin.length];
        const concept_id = mod.concepts[(day - 1) % mod.concepts.length];
        const difficulty_1to5 = Math.min(5, Math.max(1, 1 + Math.floor((day - 1) / 6))); // ramp 1→5 over ~30 days
        sessions.push({
            id: `${skillId}__d${String(day).padStart(2, '0')}`,
            skill_id: skillId,
            module_id: mod.module_id,
            day,
            planned_for: addDaysISO(startDateISO, day - 1),
            concept_id,
            difficulty_1to5,
            title_i18n: mkI18n(
                `Day ${day}: ${concept_id.replace(/_/g, ' ')}`,
                `Día ${day}: ${concept_id.replace(/_/g, ' ')}`,
                `Jour ${day} : ${concept_id.replace(/_/g, ' ')}`
            ),
            status: 'planned',
            content_version: 1
        });
    }
    return sessions;
}

function seedAwsStorage(skillId, startDateISO) {
    const skill = {
        id: skillId,
        skill_type: 'certification',
        title_i18n: mkI18n('AWS Storage (Starter)', 'AWS Storage (Inicio)', 'AWS Storage (Débutant)'),
        description_i18n: mkI18n(
            'Decision-first 30-day roadmap covering S3 vs EBS, storage classes, lifecycle, and snapshots.',
            'Roadmap decision-first de 30 días: S3 vs EBS, clases, lifecycle y snapshots.',
            'Roadmap decision-first de 30 jours : S3 vs EBS, classes, lifecycle et snapshots.'
        ),
        duration_days: 30,
        start_date: startDateISO,
        content_version: 1
    };

    const modules = [
        {
            id: `${skillId}__m_s3`,
            skill_id: skillId,
            order: 1,
            title_i18n: mkI18n('Amazon S3', 'Amazon S3', 'Amazon S3'),
            summary_i18n: mkI18n('Object storage decisions and tradeoffs.', 'Decisiones y tradeoffs de almacenamiento de objetos.', 'Décisions et compromis du stockage objet.'),
            concept_ids: ['storage_object_vs_block', 's3_storage_classes', 's3_lifecycle']
        },
        {
            id: `${skillId}__m_block`,
            skill_id: skillId,
            order: 2,
            title_i18n: mkI18n('Block storage', 'Bloques', 'Bloc'),
            summary_i18n: mkI18n('EBS volumes, snapshots, DR.', 'Volúmenes EBS, snapshots, DR.', 'Volumes EBS, snapshots, PRA.'),
            concept_ids: ['ebs_snapshots', 'cross_region_replication']
        }
    ];

    const quizzes = [];

    quizzes.push(buildQuiz({
        id: `${skillId}__storage_object_vs_block__v1`,
        concept_id: 'storage_object_vs_block',
        variant_id: 'v1',
        difficulty_1to5: 2,
        scenario_i18n: mkI18n(
            'Billions of photos over HTTP, global scale, need extreme durability.',
            'Miles de millones de fotos por HTTP, escala global, durabilidad extrema.',
            'Des milliards de photos via HTTP, grande échelle, durabilité extrême.'
        ),
        decision_prompt_i18n: mkI18n('Which storage fits best?', '¿Qué almacenamiento encaja mejor?', 'Quel stockage convient le mieux ?'),
        options_i18n: [
            mkI18n('EBS (block)', 'EBS (bloques)', 'EBS (bloc)'),
            mkI18n('S3 (object)', 'S3 (objetos)', 'S3 (objet)'),
            mkI18n('EFS (file)', 'EFS (archivos)', 'EFS (fichier)'),
            mkI18n('Instance store', 'Instance store', "Stockage d'instance")
        ],
        correct_index: 1,
        explain_i18n: mkI18n('S3 is object storage built for massive scale and HTTP access.', 'S3 es almacenamiento de objetos para escala masiva y acceso HTTP.', "S3 est un stockage objet pour grande échelle et accès HTTP."),
        trap_i18n: mkI18n('Picking “a disk” without matching access pattern.', 'Elegir “un disco” sin encajar patrón de acceso.', "Choisir “un disque” sans correspondre au mode d'accès."),
        hint_i18n: mkI18n('How is it accessed: disk, file share, or HTTP objects?', '¿Se accede como disco, share o objetos HTTP?', "Accès : disque, partage de fichiers, ou objets HTTP ?"),
        tags: ['fundamentals'],
        resources: {
            yt: buildResource({
                kind: 'yt',
                title_i18n: mkI18n('S3 overview (search)', 'S3 overview (búsqueda)', 'S3 aperçu (recherche)'),
                url: 'https://www.youtube.com/results?search_query=AWS+S3+overview',
                source_ref: 'curated:youtube_search'
            }),
            web: buildResource({
                kind: 'web',
                title_i18n: mkI18n('AWS docs: Amazon S3', 'AWS docs: Amazon S3', 'AWS docs : Amazon S3'),
                url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html',
                source_ref: 'official:aws_s3_docs'
            }),
            micro: buildResource({
                kind: 'micro',
                title_i18n: mkI18n('Micro: write the main constraint in 10 words.', 'Micro: escribe la restricción principal en 10 palabras.', 'Micro : écrivez la contrainte principale en 10 mots.'),
                source_ref: 'generated:micro'
            }),
            habit: buildResource({
                kind: 'habit',
                title_i18n: mkI18n('Habit: state “latency vs cost vs durability” before choosing.', 'Hábito: declara “latencia vs coste vs durabilidad” antes de elegir.', "Habitude : écrire “latence vs coût vs durabilité” avant de choisir."),
                source_ref: 'generated:habit'
            })
        }
    }));

    quizzes.push(buildQuiz({
        id: `${skillId}__storage_object_vs_block__v2`,
        concept_id: 'storage_object_vs_block',
        variant_id: 'v2',
        difficulty_1to5: 2,
        scenario_i18n: mkI18n(
            'A database needs low-latency random reads/writes like a disk on EC2.',
            'Una BD necesita lecturas/escrituras aleatorias de baja latencia como un disco en EC2.',
            "Une BD nécessite des lectures/écritures aléatoires à faible latence comme un disque sur EC2."
        ),
        decision_prompt_i18n: mkI18n('Which storage fits best?', '¿Qué almacenamiento encaja mejor?', 'Quel stockage convient le mieux ?'),
        options_i18n: [
            mkI18n('S3', 'S3', 'S3'),
            mkI18n('EBS', 'EBS', 'EBS'),
            mkI18n('Glacier', 'Glacier', 'Glacier'),
            mkI18n('CloudFront', 'CloudFront', 'CloudFront')
        ],
        correct_index: 1,
        explain_i18n: mkI18n('EBS provides block device semantics and low latency for EC2.', 'EBS ofrece semántica de bloque y baja latencia para EC2.', 'EBS fournit une sémantique bloc et faible latence pour EC2.'),
        trap_i18n: mkI18n('Choosing S3 because it is “storage” ignores block device semantics.', 'Elegir S3 por ser “storage” ignora semántica de bloque.', 'Choisir S3 car “stockage” ignore la sémantique bloc.'),
        hint_i18n: mkI18n('If it needs a disk, start with block storage.', 'Si necesita disco, empieza por bloques.', 'Si besoin de disque, commencez par stockage bloc.'),
        tags: ['fundamentals']
    }));

    quizzes.push(buildQuiz({
        id: `${skillId}__s3_storage_classes__v1`,
        concept_id: 's3_storage_classes',
        variant_id: 'v1',
        difficulty_1to5: 3,
        scenario_i18n: mkI18n(
            '10TB archived for 7 years, accessed <1x/year, must be retrievable within 24h.',
            '10TB archivados 7 años, acceso <1 vez/año, recuperable en 24h.',
            '10 To archivés 7 ans, accès <1x/an, récupérable en 24h.'
        ),
        decision_prompt_i18n: mkI18n('Best S3 class?', '¿Mejor clase S3?', 'Meilleure classe S3 ?'),
        options_i18n: [
            mkI18n('S3 Standard', 'S3 Standard', 'S3 Standard'),
            mkI18n('S3 Intelligent-Tiering', 'S3 Intelligent-Tiering', 'S3 Intelligent-Tiering'),
            mkI18n('S3 Glacier Instant Retrieval', 'S3 Glacier Instant Retrieval', 'S3 Glacier Instant Retrieval'),
            mkI18n('S3 Glacier Deep Archive', 'S3 Glacier Deep Archive', 'S3 Glacier Deep Archive')
        ],
        correct_index: 2,
        explain_i18n: mkI18n('Instant Retrieval fits rare access with fast retrieval.', 'Instant Retrieval encaja con acceso raro y recuperación rápida.', "Instant Retrieval convient à l'accès rare avec récupération rapide."),
        trap_i18n: mkI18n('Deep Archive can take longer to retrieve.', 'Deep Archive puede tardar más en recuperar.', 'Deep Archive peut être plus lent à récupérer.'),
        hint_i18n: mkI18n('Look at retrieval time first.', 'Mira primero el tiempo de recuperación.', 'Regardez le temps de récupération.'),
        tags: ['s3', 'classes']
    }));

    quizzes.push(buildQuiz({
        id: `${skillId}__s3_storage_classes__v2`,
        concept_id: 's3_storage_classes',
        variant_id: 'v2',
        difficulty_1to5: 3,
        scenario_i18n: mkI18n(
            'Frequently accessed web assets with unpredictable spikes, low latency required.',
            'Assets web muy accedidos con picos impredecibles, latencia baja requerida.',
            "Assets web très consultés avec pics imprévisibles, latence faible requise."
        ),
        decision_prompt_i18n: mkI18n('Best default class?', '¿Mejor clase por defecto?', 'Meilleure classe par défaut ?'),
        options_i18n: [
            mkI18n('S3 Standard', 'S3 Standard', 'S3 Standard'),
            mkI18n('S3 One Zone-IA', 'S3 One Zone-IA', 'S3 One Zone-IA'),
            mkI18n('Glacier', 'Glacier', 'Glacier'),
            mkI18n('Deep Archive', 'Deep Archive', 'Deep Archive')
        ],
        correct_index: 0,
        explain_i18n: mkI18n('Standard fits frequent access and performance.', 'Standard encaja con acceso frecuente y rendimiento.', "Standard convient à l'accès fréquent et performance."),
        trap_i18n: mkI18n('IA/Glacier optimize cost for infrequent access, not spikes.', 'IA/Glacier optimizan coste para acceso infrecuente, no picos.', 'IA/Glacier optimisent le coût pour accès rare, pas pour pics.'),
        hint_i18n: mkI18n('Frequent access -> Standard.', 'Acceso frecuente -> Standard.', 'Accès fréquent -> Standard.'),
        tags: ['s3', 'classes']
    }));

    quizzes.push(buildQuiz({
        id: `${skillId}__ebs_snapshots__v1`,
        concept_id: 'ebs_snapshots',
        variant_id: 'v1',
        difficulty_1to5: 3,
        scenario_i18n: mkI18n(
            'EBS volume in us-east-1 must be backed up to us-west-1 for DR.',
            'Volumen EBS en us-east-1 debe respaldarse en us-west-1 para DR.',
            "Volume EBS en us-east-1 doit être sauvegardé vers us-west-1 pour PRA."
        ),
        decision_prompt_i18n: mkI18n('Most direct approach?', '¿Enfoque más directo?', 'Approche la plus directe ?'),
        options_i18n: [
            mkI18n('Copy the volume files manually', 'Copiar archivos manualmente', 'Copier les fichiers manuellement'),
            mkI18n('Create a snapshot and copy it cross-region', 'Crear snapshot y copiarlo cross-region', 'Créer un snapshot et le copier inter-région'),
            mkI18n('Use CloudFront', 'Usar CloudFront', 'Utiliser CloudFront'),
            mkI18n('Switch to EFS', 'Cambiar a EFS', 'Passer à EFS')
        ],
        correct_index: 1,
        explain_i18n: mkI18n('Snapshots can be copied across regions directly.', 'Los snapshots se pueden copiar entre regiones.', 'Les snapshots peuvent être copiés entre régions.'),
        trap_i18n: mkI18n('Mixing services: CloudFront is not DR replication.', 'Mezclar servicios: CloudFront no es replicación DR.', "Mélanger : CloudFront n'est pas une réplication PRA."),
        hint_i18n: mkI18n('Back up EBS using its native unit.', 'Haz backup de EBS con su unidad nativa.', "Sauvegardez EBS avec son unité native."),
        tags: ['ebs', 'backup', 'dr']
    }));

    quizzes.push(buildQuiz({
        id: `${skillId}__ebs_snapshots__v2`,
        concept_id: 'ebs_snapshots',
        variant_id: 'v2',
        difficulty_1to5: 3,
        scenario_i18n: mkI18n(
            'You want point-in-time backups with minimal ops overhead.',
            'Quieres backups point-in-time con mínimo overhead operativo.',
            'Vous voulez des sauvegardes point-in-time avec peu d’overhead.'
        ),
        decision_prompt_i18n: mkI18n('What should you use?', '¿Qué usarías?', 'Que faut-il utiliser ?'),
        options_i18n: [
            mkI18n('EBS snapshots', 'Snapshots EBS', 'Snapshots EBS'),
            mkI18n('S3 lifecycle', 'Lifecycle S3', 'Lifecycle S3'),
            mkI18n('CloudFront invalidation', 'Invalidación CloudFront', 'Invalidation CloudFront'),
            mkI18n('Glacier vault lock', 'Vault lock Glacier', 'Vault lock Glacier')
        ],
        correct_index: 0,
        explain_i18n: mkI18n('Snapshots are managed backups for EBS.', 'Los snapshots son backups administrados para EBS.', 'Les snapshots sont des sauvegardes gérées pour EBS.'),
        trap_i18n: mkI18n('Lifecycle policies do not back up EBS.', 'Las políticas lifecycle no respaldan EBS.', "Les politiques lifecycle ne sauvegardent pas EBS."),
        hint_i18n: mkI18n('Use the native backup mechanism.', 'Usa el mecanismo nativo.', 'Utilisez le mécanisme natif.'),
        tags: ['ebs', 'backup']
    }));

    // One-variant concepts used in schedule (still i18n + concept_id stability)
    quizzes.push(buildQuiz({
        id: `${skillId}__s3_lifecycle__v1`,
        concept_id: 's3_lifecycle',
        variant_id: 'v1',
        difficulty_1to5: 2,
        scenario_i18n: mkI18n('Objects should transition to cheaper storage after 30 days and delete after 365 days.', 'Objetos pasan a storage barato tras 30 días y se borran tras 365 días.', 'Objets passent à un stockage moins cher après 30 jours et supprimés après 365 jours.'),
        decision_prompt_i18n: mkI18n('What do you configure?', '¿Qué configuras?', 'Que configurez-vous ?'),
        options_i18n: [
            mkI18n('S3 Lifecycle rules', 'Reglas Lifecycle S3', 'Règles Lifecycle S3'),
            mkI18n('Only S3 Versioning', 'Solo Versioning', 'Versioning seulement'),
            mkI18n('EBS snapshots', 'Snapshots EBS', 'Snapshots EBS'),
            mkI18n('IAM policy', 'Política IAM', 'Politique IAM')
        ],
        correct_index: 0,
        explain_i18n: mkI18n('Lifecycle rules automate transitions and expiration.', 'Lifecycle automatiza transiciones y expiración.', "Les règles lifecycle automatisent transitions et expiration."),
        trap_i18n: mkI18n('Versioning is not a lifecycle rule.', 'Versioning no es una regla lifecycle.', "Le versioning n'est pas une règle lifecycle."),
        tags: ['s3', 'lifecycle']
    }));

    quizzes.push(buildQuiz({
        id: `${skillId}__cross_region_replication__v1`,
        concept_id: 'cross_region_replication',
        variant_id: 'v1',
        difficulty_1to5: 4,
        scenario_i18n: mkI18n('You want a lower RPO for S3 objects across regions.', 'Quieres RPO más bajo para objetos S3 entre regiones.', "Vous voulez un RPO plus faible pour des objets S3 entre régions."),
        decision_prompt_i18n: mkI18n('What should you enable?', '¿Qué habilitas?', 'Que faut-il activer ?'),
        options_i18n: [
            mkI18n('S3 Cross-Region Replication (CRR)', 'CRR de S3', 'CRR S3'),
            mkI18n('CloudFront cache', 'Caché CloudFront', 'Cache CloudFront'),
            mkI18n('EBS fast snapshot restore', 'Fast snapshot restore EBS', 'Fast snapshot restore EBS'),
            mkI18n('S3 Transfer Acceleration', 'Transfer Acceleration', 'Transfer Acceleration')
        ],
        correct_index: 0,
        explain_i18n: mkI18n('CRR replicates objects to a destination region asynchronously.', 'CRR replica objetos a otra región de forma asíncrona.', 'CRR réplique des objets vers une région cible de façon asynchrone.'),
        trap_i18n: mkI18n('CloudFront is a cache, not a DR copy.', 'CloudFront es caché, no copia DR.', "CloudFront est un cache, pas une copie PRA."),
        tags: ['s3', 'dr']
    }));

    const sessions = scheduleSessions({ skillId, modules, startDateISO });
    return { skill, modules, sessions, quizzes };
}

function seedFrenchBasics(skillId, startDateISO) {
    const skill = {
        id: skillId,
        skill_type: 'language',
        title_i18n: mkI18n('French (Starter)', 'Francés (Inicio)', 'Français (Débutant)'),
        description_i18n: mkI18n('30 days of tiny decisions: greetings and essentials.', '30 días de decisiones pequeñas: saludos y esenciales.', '30 jours de petites décisions : salutations et essentiels.'),
        duration_days: 30,
        start_date: startDateISO,
        content_version: 1
    };

    const modules = [
        {
            id: `${skillId}__m_core`,
            skill_id: skillId,
            order: 1,
            title_i18n: mkI18n('Core phrases', 'Frases base', 'Phrases de base'),
            summary_i18n: mkI18n('Greetings, introductions, polite requests.', 'Saludos, presentaciones, peticiones.', 'Salutations, présentations, demandes polies.'),
            concept_ids: ['fr_greetings', 'fr_polite_requests']
        }
    ];

    const quizzes = [
        buildQuiz({
            id: `${skillId}__fr_greetings__v1`,
            concept_id: 'fr_greetings',
            variant_id: 'v1',
            difficulty_1to5: 1,
            scenario_i18n: mkI18n('You enter a shop at 10:00.', 'Entras a una tienda a las 10:00.', 'Vous entrez dans une boutique à 10h00.'),
            decision_prompt_i18n: mkI18n('What do you say first?', '¿Qué dices primero?', 'Que dites-vous en premier ?'),
            options_i18n: [mkI18n('Bonsoir', 'Bonsoir', 'Bonsoir'), mkI18n('Bonjour', 'Bonjour', 'Bonjour'), mkI18n('Bonne nuit', 'Bonne nuit', 'Bonne nuit'), mkI18n('Salut', 'Salut', 'Salut')],
            correct_index: 1,
            explain_i18n: mkI18n('Bonjour is the standard daytime greeting.', 'Bonjour es el saludo estándar de día.', 'Bonjour est la salutation standard en journée.'),
            trap_i18n: mkI18n('Bonsoir is for evening.', 'Bonsoir es para la tarde/noche.', 'Bonsoir est pour le soir.'),
            tags: ['language', 'greetings']
        }),
        buildQuiz({
            id: `${skillId}__fr_greetings__v2`,
            concept_id: 'fr_greetings',
            variant_id: 'v2',
            difficulty_1to5: 1,
            scenario_i18n: mkI18n('You meet a friend casually on the street.', 'Te encuentras con un amigo en la calle.', 'Vous croisez un ami dans la rue.'),
            decision_prompt_i18n: mkI18n('Best casual greeting?', '¿Mejor saludo casual?', 'Meilleure salutation familière ?'),
            options_i18n: [mkI18n('Salut', 'Salut', 'Salut'), mkI18n('Monsieur', 'Monsieur', 'Monsieur'), mkI18n('Merci', 'Merci', 'Merci'), mkI18n('Au revoir', 'Au revoir', 'Au revoir')],
            correct_index: 0,
            explain_i18n: mkI18n('Salut is casual and friendly.', 'Salut es casual y amistoso.', 'Salut est familier et amical.'),
            trap_i18n: mkI18n('Au revoir is “goodbye”.', 'Au revoir es “adiós”.', 'Au revoir signifie “au revoir”.'),
            tags: ['language', 'greetings']
        }),
        buildQuiz({
            id: `${skillId}__fr_polite_requests__v1`,
            concept_id: 'fr_polite_requests',
            variant_id: 'v1',
            difficulty_1to5: 2,
            scenario_i18n: mkI18n('You want to ask for water politely at a cafe.', 'Quieres pedir agua educadamente en un café.', "Vous voulez demander de l'eau poliment au café."),
            decision_prompt_i18n: mkI18n('Pick the best phrase.', 'Elige la mejor frase.', 'Choisissez la meilleure phrase.'),
            options_i18n: [mkI18n("De l'eau, s'il te plaît.", "De l'eau, s'il te plaît.", "De l'eau, s'il te plaît."), mkI18n("De l'eau, s'il vous plaît.", "De l'eau, s'il vous plaît.", "De l'eau, s'il vous plaît."), mkI18n("Donne-moi de l'eau.", 'Donne-moi de l’eau.', "Donne-moi de l'eau."), mkI18n("Je suis de l'eau.", 'Je suis de l’eau.', "Je suis de l'eau.")],
            correct_index: 1,
            explain_i18n: mkI18n("“S'il vous plaît” is more polite in service contexts.", "“S'il vous plaît” es más formal en contextos de servicio.", "“S'il vous plaît” est plus poli en contexte de service."),
            trap_i18n: mkI18n('Using “tu” in formal contexts.', 'Usar “tu” en contextos formales.', 'Utiliser “tu” en contexte formel.'),
            tags: ['language', 'polite']
        })
    ];

    const sessions = scheduleSessions({ skillId, modules, startDateISO });
    return { skill, modules, sessions, quizzes };
}

function seedAzureIAM(skillId, startDateISO) {
    const skill = {
        id: skillId,
        skill_type: 'certification',
        title_i18n: mkI18n('Azure IAM (Starter)', 'Azure IAM (Inicio)', 'Azure IAM (Débutant)'),
        description_i18n: mkI18n(
            'Decision-first roadmap covering least privilege, RBAC scopes, and role assignments.',
            'Roadmap decision-first: mínimo privilegio, scopes RBAC y asignación de roles.',
            'Roadmap decision-first : moindre privilège, scopes RBAC, assignation de rôles.'
        ),
        duration_days: 30,
        start_date: startDateISO,
        content_version: 1
    };

    const modules = [
        {
            id: `${skillId}__m_rbac`,
            skill_id: skillId,
            order: 1,
            title_i18n: mkI18n('RBAC fundamentals', 'Fundamentos RBAC', 'Fondamentaux RBAC'),
            summary_i18n: mkI18n('Scope, role assignment, least privilege.', 'Scope, asignación de roles, mínimo privilegio.', 'Scope, assignation de rôles, moindre privilège.'),
            concept_ids: ['least_privilege_roles', 'rbac_scope_subscription_rg_resource']
        }
    ];

    const quizzes = [
        buildQuiz({
            id: `${skillId}__least_privilege_roles__v1`,
            concept_id: 'least_privilege_roles',
            variant_id: 'v1',
            difficulty_1to5: 2,
            scenario_i18n: mkI18n('A teammate needs to read blobs but must not delete anything.', 'Un colega necesita leer blobs pero no borrar.', "Un collègue doit lire des blobs mais ne doit rien supprimer."),
            decision_prompt_i18n: mkI18n('What principle should guide the role choice?', '¿Qué principio guía la elección?', 'Quel principe guide le choix ?'),
            options_i18n: [mkI18n('Least privilege', 'Mínimo privilegio', 'Moindre privilège'), mkI18n('Grant Owner for speed', 'Dar Owner por rapidez', 'Donner Owner pour aller vite'), mkI18n('Grant Contributor by default', 'Dar Contributor por defecto', 'Donner Contributor par défaut'), mkI18n('Give access to the whole subscription', 'Acceso a toda la suscripción', "Accès à toute la souscription")],
            correct_index: 0,
            explain_i18n: mkI18n('Grant only what is needed to reduce blast radius.', 'Concede solo lo necesario para reducir impacto.', "Accorder seulement le nécessaire pour réduire l'impact."),
            trap_i18n: mkI18n('Over-permissioning for convenience creates long-term risk.', 'Sobre-permisos por comodidad crean riesgo.', "Sur-permissionner par confort crée un risque."),
            tags: ['azure', 'iam']
        }),
        buildQuiz({
            id: `${skillId}__least_privilege_roles__v2`,
            concept_id: 'least_privilege_roles',
            variant_id: 'v2',
            difficulty_1to5: 3,
            scenario_i18n: mkI18n('An automation job needs to restart a single VM weekly.', 'Un job de automatización necesita reiniciar una única VM.', "Un job d'automatisation doit redémarrer une seule VM."),
            decision_prompt_i18n: mkI18n('Where should you scope the permission?', '¿Dónde acotar el permiso?', 'Où devez-vous limiter le scope ?'),
            options_i18n: [mkI18n('At the VM resource', 'En el recurso VM', 'Au niveau de la ressource VM'), mkI18n('At the whole resource group', 'En todo el resource group', 'Au niveau du resource group'), mkI18n('At the subscription', 'En la suscripción', 'Au niveau de la souscription'), mkI18n('At the tenant root', 'En el root del tenant', 'À la racine du tenant')],
            correct_index: 0,
            explain_i18n: mkI18n('Scope as narrowly as possible: the target VM.', 'Acota lo máximo: la VM objetivo.', "Limitez au maximum : la VM cible."),
            trap_i18n: mkI18n('Scoping at subscription is common but unnecessary here.', 'Acotar a suscripción es común pero innecesario aquí.', "Limiter à la souscription est fréquent mais inutile ici."),
            tags: ['azure', 'iam']
        }),
        buildQuiz({
            id: `${skillId}__rbac_scope_subscription_rg_resource__v1`,
            concept_id: 'rbac_scope_subscription_rg_resource',
            variant_id: 'v1',
            difficulty_1to5: 2,
            scenario_i18n: mkI18n('You must allow read access only to one storage account.', 'Debes dar acceso solo a una cuenta de storage.', "Vous devez donner accès en lecture à un seul compte de stockage."),
            decision_prompt_i18n: mkI18n('What scope is best?', '¿Qué scope es mejor?', 'Quel scope est le meilleur ?'),
            options_i18n: [mkI18n('Resource (storage account)', 'Recurso (storage account)', 'Ressource (compte de stockage)'), mkI18n('Resource group', 'Resource group', 'Resource group'), mkI18n('Subscription', 'Suscripción', 'Souscription'), mkI18n('Management group', 'Management group', 'Management group')],
            correct_index: 0,
            explain_i18n: mkI18n('Use the narrowest scope that meets the need.', 'Usa el scope más estrecho que cumpla.', "Utilisez le scope le plus étroit possible."),
            trap_i18n: mkI18n('Broad scopes increase accidental access.', 'Scopes amplios aumentan acceso accidental.', "Scopes larges augmentent l'accès accidentel."),
            tags: ['azure', 'rbac']
        })
    ];

    const sessions = scheduleSessions({ skillId, modules, startDateISO });
    return { skill, modules, sessions, quizzes };
}

function seedHabitDeepWork(skillId, startDateISO) {
    const skill = {
        id: skillId,
        skill_type: 'habit',
        title_i18n: mkI18n('Deep Work Habit (Starter)', 'Hábito Deep Work (Inicio)', 'Habitude Deep Work (Débutant)'),
        description_i18n: mkI18n('30 days of micro-decisions to build a sustainable deep-work routine.', '30 días de micro-decisiones para construir una rutina sostenible de deep work.', "30 jours de micro-décisions pour construire une routine de deep work."),
        duration_days: 30,
        start_date: startDateISO,
        content_version: 1
    };

    const modules = [
        {
            id: `${skillId}__m_setup`,
            skill_id: skillId,
            order: 1,
            title_i18n: mkI18n('Setup', 'Preparación', 'Mise en place'),
            summary_i18n: mkI18n('Environment, schedule, and friction removal.', 'Entorno, horario y reducir fricción.', 'Environnement, planning, réduction de friction.'),
            concept_ids: ['deep_work_time_block', 'deep_work_distraction_plan']
        }
    ];

    const quizzes = [
        buildQuiz({
            id: `${skillId}__deep_work_time_block__v1`,
            concept_id: 'deep_work_time_block',
            variant_id: 'v1',
            difficulty_1to5: 1,
            scenario_i18n: mkI18n('You have 30 minutes today. Your phone is on your desk.', 'Tienes 30 minutos hoy. Tu móvil está en la mesa.', "Vous avez 30 minutes aujourd'hui. Votre téléphone est sur le bureau."),
            decision_prompt_i18n: mkI18n('What is the best first decision?', '¿Cuál es la mejor primera decisión?', 'Quelle est la meilleure première décision ?'),
            options_i18n: [mkI18n('Put phone in another room', 'Dejar el móvil en otra habitación', 'Mettre le téléphone dans une autre pièce'), mkI18n('Start anyway', 'Empezar igual', 'Commencer quand même'), mkI18n('Open email first', 'Abrir email primero', "Ouvrir les emails d'abord"), mkI18n('Wait for motivation', 'Esperar motivación', 'Attendre la motivation')],
            correct_index: 0,
            explain_i18n: mkI18n('Remove the distraction before starting; it reduces willpower cost.', 'Quita la distracción antes de empezar; reduce coste de fuerza de voluntad.', "Retirez la distraction avant de commencer ; cela réduit le coût en volonté."),
            trap_i18n: mkI18n('Relying on willpower instead of environment design.', 'Depender de fuerza de voluntad en vez de diseñar el entorno.', "Compter sur la volonté plutôt que sur le design de l'environnement."),
            tags: ['habit', 'focus']
        }),
        buildQuiz({
            id: `${skillId}__deep_work_distraction_plan__v1`,
            concept_id: 'deep_work_distraction_plan',
            variant_id: 'v1',
            difficulty_1to5: 2,
            scenario_i18n: mkI18n('During focus time, you remember “I should check Slack”.', 'Durante foco, recuerdas “debería mirar Slack”.', 'Pendant le focus, vous pensez “je devrais regarder Slack”.'),
            decision_prompt_i18n: mkI18n('What is the best move?', '¿Qué es lo mejor?', 'Quel est le meilleur geste ?'),
            options_i18n: [mkI18n('Write it down and return to task', 'Apuntarlo y volver a la tarea', 'Noter et revenir à la tâche'), mkI18n('Check quickly', 'Mirar rápido', 'Vérifier vite'), mkI18n('Stop the session', 'Parar la sesión', 'Arrêter la session'), mkI18n('Switch tasks', 'Cambiar de tarea', 'Changer de tâche')],
            correct_index: 0,
            explain_i18n: mkI18n('Use a capture list to offload without context-switching.', 'Usa una lista de captura para descargar sin cambiar de contexto.', 'Utilisez une liste de capture sans changer de contexte.'),
            trap_i18n: mkI18n('“Quick check” often becomes 20 minutes.', '“Mirar rápido” suele ser 20 minutos.', "Le “petit check” devient souvent 20 minutes."),
            tags: ['habit', 'focus']
        })
    ];

    const sessions = scheduleSessions({ skillId, modules, startDateISO });
    return { skill, modules, sessions, quizzes };
}

function seedGeneric(skillId, topic, skillType, startDateISO) {
    const skill = {
        id: skillId,
        skill_type: skillType,
        title_i18n: mkI18n(topic, topic, topic),
        description_i18n: mkI18n(
            'Auto-generated 30-day roadmap (local MVP). Replace the generator with a remote API later.',
            'Roadmap autogenerado 30 días (MVP local). Sustituye el generador por una API remota.',
            'Roadmap auto-généré 30 jours (MVP local). Remplacez le générateur par une API distante.'
        ),
        duration_days: 30,
        start_date: startDateISO,
        content_version: 1
    };

    const concepts = [
        `${slugify(topic)}__core`,
        `${slugify(topic)}__tradeoffs`,
        `${slugify(topic)}__practice`,
        `${slugify(topic)}__common_traps`,
        `${slugify(topic)}__transfer`
    ];

    const modules = [
        { id: `${skillId}__m1`, skill_id: skillId, order: 1, title_i18n: mkI18n('Fundamentals', 'Fundamentos', 'Fondamentaux'), summary_i18n: mkI18n('Definitions and first principles.', 'Definiciones y primeros principios.', 'Définitions et premiers principes.'), concept_ids: concepts.slice(0, 2) },
        { id: `${skillId}__m2`, skill_id: skillId, order: 2, title_i18n: mkI18n('Applied', 'Aplicado', 'Appliqué'), summary_i18n: mkI18n('Scenarios and decisions.', 'Escenarios y decisiones.', 'Scénarios et décisions.'), concept_ids: concepts.slice(2, 4) },
        { id: `${skillId}__m3`, skill_id: skillId, order: 3, title_i18n: mkI18n('Mastery', 'Maestría', 'Maîtrise'), summary_i18n: mkI18n('Transfer check and real-world feedback.', 'Transfer check y feedback de vida real.', 'Transfer check et feedback du monde réel.'), concept_ids: concepts.slice(4) }
    ];

    const buildDecision = (conceptId, variant) => {
        const baseConstraint = variant === 'v1'
            ? mkI18n('Time is limited and you need the fastest safe path.', 'El tiempo es limitado y necesitas el camino seguro más rápido.', 'Le temps est limité et vous cherchez la voie la plus sûre et rapide.')
            : mkI18n('Cost matters, but correctness still matters.', 'El coste importa, pero la corrección también.', 'Le coût compte, mais la justesse aussi.');

        if (skillType === 'language') {
            return {
                scenario_i18n: mkI18n(
                    `You’re in a real conversation about "${topic}". You must choose the best phrase.`,
                    `Estás en una conversación real sobre "${topic}". Debes elegir la mejor frase.`,
                    `Vous êtes dans une conversation réelle sur "${topic}". Choisissez la meilleure phrase.`
                ),
                decision_prompt_i18n: mkI18n('Which phrase is most appropriate?', '¿Qué frase es más adecuada?', 'Quelle phrase est la plus appropriée ?'),
                options_i18n: [mkI18n('Option 1 (formal)', 'Opción 1 (formal)', 'Option 1 (formel)'), mkI18n('Option 2 (casual)', 'Opción 2 (casual)', 'Option 2 (familier)'), mkI18n('Option 3 (incorrect)', 'Opción 3 (incorrecta)', 'Option 3 (incorrect)'), mkI18n('Option 4 (awkward)', 'Opción 4 (rara)', 'Option 4 (maladroite)')],
                correct_index: 0,
                explain_i18n: mkI18n('Pick the phrase that matches context + politeness level.', 'Elige la frase que encaja con el contexto + nivel de formalidad.', 'Choisissez la phrase adaptée au contexte + niveau de politesse.'),
                trap_i18n: mkI18n('Choosing a phrase that sounds right but mismatches context.', 'Elegir una frase que suena bien pero no encaja en el contexto.', "Choisir une phrase qui sonne bien mais ne correspond pas au contexte."),
                action_practice_i18n: mkI18n('Practice 20 minutes: say the correct phrase aloud in 10 different contexts.', 'Práctica 20 min: di la frase correcta en 10 contextos distintos.', 'Pratique 20 min : dites la phrase correcte dans 10 contextes différents.'),
                mini_challenge_i18n: mkI18n('Record yourself once and compare tone + clarity.', 'Grábate una vez y compara tono + claridad.', 'Enregistrez-vous une fois et comparez ton + clarté.'),
                difficulty_1to5: variant === 'v1' ? 2 : 3,
                tags: ['generated', 'language']
            };
        }

        if (skillType === 'habit') {
            return {
                scenario_i18n: mkI18n(
                    `You’re trying to build "${topic}". A distraction appears right before you start.`,
                    `Intentas construir "${topic}". Aparece una distracción justo antes de empezar.`,
                    `Vous essayez de construire "${topic}". Une distraction apparaît juste avant de commencer.`
                ),
                decision_prompt_i18n: mkI18n('What is the best first decision?', '¿Cuál es la mejor primera decisión?', 'Quelle est la meilleure première décision ?'),
                options_i18n: [mkI18n('Remove friction now', 'Quitar fricción ahora', 'Réduire la friction maintenant'), mkI18n('Rely on willpower', 'Depender de fuerza de voluntad', 'Compter sur la volonté'), mkI18n('Delay 10 minutes', 'Posponer 10 minutos', 'Reporter 10 minutes'), mkI18n('Change the goal', 'Cambiar la meta', "Changer l'objectif")],
                correct_index: 0,
                explain_i18n: mkI18n('Environment beats willpower; remove friction first.', 'El entorno gana a la fuerza de voluntad; quita fricción primero.', "L'environnement bat la volonté ; réduisez la friction d'abord."),
                trap_i18n: mkI18n('“Just this time” becomes a pattern.', '“Solo esta vez” se vuelve patrón.', '“Juste cette fois” devient un pattern.'),
                action_practice_i18n: mkI18n('20 minutes: set up the environment and start a 1-block session.', '20 min: prepara el entorno y empieza una sesión de 1 bloque.', '20 min : préparez l’environnement et lancez un bloc.'),
                mini_challenge_i18n: mkI18n('Write a 1-line “if distraction then…” plan.', 'Escribe un plan de 1 línea “si distracción entonces…”.', 'Écrivez un plan en 1 ligne “si distraction alors…”.'),
                difficulty_1to5: variant === 'v1' ? 1 : 2,
                tags: ['generated', 'habit']
            };
        }

        // technical/certification/cognitive
        return {
            scenario_i18n: mkI18n(
                `You’re working on "${topic}". Constraint: ${baseConstraint.en}`,
                `Estás trabajando en "${topic}". Restricción: ${baseConstraint.es}`,
                `Vous travaillez sur "${topic}". Contrainte : ${baseConstraint.fr}`
            ),
            decision_prompt_i18n: mkI18n('Which decision best fits the constraint?', '¿Qué decisión encaja mejor con la restricción?', 'Quelle décision correspond le mieux à la contrainte ?'),
            options_i18n: [
                mkI18n('Choose the simplest safe option', 'Elegir la opción más simple y segura', 'Choisir l’option la plus simple et sûre'),
                mkI18n('Optimize for cost first', 'Optimizar coste primero', 'Optimiser le coût d’abord'),
                mkI18n('Optimize for speed first', 'Optimizar velocidad primero', 'Optimiser la vitesse d’abord'),
                mkI18n('Add complexity to be future-proof', 'Añadir complejidad por futuro', 'Ajouter de la complexité pour le futur')
            ],
            correct_index: 0,
            explain_i18n: mkI18n('Start with the simplest option that meets constraints; then iterate.', 'Empieza con lo más simple que cumpla; luego itera.', 'Commencez par le plus simple qui respecte les contraintes ; puis itérez.'),
            trap_i18n: mkI18n('Premature optimization hides the real constraint.', 'Optimización prematura oculta la restricción real.', 'L’optimisation prématurée masque la vraie contrainte.'),
            action_practice_i18n: mkI18n('20–30 min: write a 5-line decision record (constraint → choice → tradeoff).', '20–30 min: escribe un registro de decisión de 5 líneas (restricción → elección → tradeoff).', '20–30 min : écrivez une décision en 5 lignes (contrainte → choix → compromis).'),
            mini_challenge_i18n: mkI18n('Find one counterexample where the “simple” choice fails.', 'Encuentra un contraejemplo donde “lo simple” falla.', 'Trouvez un contre-exemple où le choix “simple” échoue.'),
            difficulty_1to5: variant === 'v1' ? 2 : 3,
            tags: ['generated', skillType]
        };
    };

    const quizzes = concepts.flatMap(concept_id => {
        const v1 = buildDecision(concept_id, 'v1');
        const v2 = buildDecision(concept_id, 'v2');
        return [
            buildQuiz({
                id: `${skillId}__${concept_id}__v1`,
                concept_id,
                variant_id: 'v1',
                difficulty_1to5: v1.difficulty_1to5,
                scenario_i18n: v1.scenario_i18n,
                decision_prompt_i18n: v1.decision_prompt_i18n,
                options_i18n: v1.options_i18n,
                correct_index: v1.correct_index,
                explain_i18n: v1.explain_i18n,
                trap_i18n: v1.trap_i18n,
                tags: v1.tags
            }),
            buildQuiz({
                id: `${skillId}__${concept_id}__v2`,
                concept_id,
                variant_id: 'v2',
                difficulty_1to5: v2.difficulty_1to5,
                scenario_i18n: v2.scenario_i18n,
                decision_prompt_i18n: v2.decision_prompt_i18n,
                options_i18n: v2.options_i18n,
                correct_index: v2.correct_index,
                explain_i18n: v2.explain_i18n,
                trap_i18n: v2.trap_i18n,
                tags: v2.tags
            })
        ];
    });

    const sessions = scheduleSessions({ skillId, modules, startDateISO });
    return { skill, modules, sessions, quizzes };
}

class CoachEngine {
    classifySkillType(topic) {
        const t = String(topic || '').toLowerCase();
        if (t.includes('french') || t.includes('français') || t.includes('frances') || t.includes('idioma') || t.includes('language')) return 'language';
        if (t.includes('habit') || t.includes('hábito') || t.includes('habito') || t.includes('routine')) return 'habit';
        if (t.includes('aws') || t.includes('azure') || t.includes('gcp') || t.includes('cert')) return 'certification';
        return 'technical';
    }

    generateBlueprint({ topic, skillType, startDateISO }) {
        const start = startDateISO || todayISO();
        const normalized = String(topic || '').trim() || 'New skill';
        const id = slugify(normalized);
        const type = skillType || this.classifySkillType(normalized);

        const low = normalized.toLowerCase();
        if (low.includes('aws') && low.includes('storage')) return seedAwsStorage(id, start);
        if (low.includes('french') || low.includes('français') || low.includes('frances')) return seedFrenchBasics(id, start);
        if (low.includes('azure')) return seedAzureIAM(id, start);
        if (low.includes('habit') || low.includes('hábito') || low.includes('habito')) return seedHabitDeepWork(id, start);
        return seedGeneric(id, normalized, type, start);
    }

    async ensureActiveSkill(uid, settings) {
        if (!uid) return null;
        const configured = settings?.active_skill_id;
        if (configured) {
            const existing = await coachStore.getSkill(uid, configured);
            if (existing) return existing;
        }
        const skills = await coachStore.listSkills(uid);
        if (skills.length > 0) return skills[0];
        return null;
    }

    async getDashboardState(uid, settings, { sessionsOverride = null } = {}) {
        const activeSkill = await this.ensureActiveSkill(uid, settings);
        const maintenance = await coachStore.getMaintenance(uid);
        const today = todayISO();
        const baseSessions = sessionsOverride || (activeSkill ? await coachStore.listSessions(uid, activeSkill.id) : []);
        const sessions = activeSkill ? (await this.ensureReviewSessions(uid, activeSkill.id)).sessions : baseSessions;

        let next = null;
        if (sessions.length > 0) {
            next =
                sessions.find(s => s.status !== 'completed' && String(s.planned_for || '9999-12-31') <= today) ||
                sessions.find(s => s.status !== 'completed') ||
                sessions[0];
        }

        const cognitive = Number(maintenance.consecutive_wrong || 0);
        const cognitive_load_label = cognitive >= 3 ? 'High' : 'Normal';

        return {
            activeSkill,
            sessions,
            maintenance,
            hasTodaySession: !!next,
            todaySession: next,
            streak_days: String(maintenance.streak_days || 0),
            today_label: today,
            cognitive_load_label,
            activeSkillTitle: activeSkill ? i18n.getContent(activeSkill.title_i18n) : i18n.t('coach_action_create_plan'),
            todaySessionTitle: next ? (next.title_i18n ? i18n.getContent(next.title_i18n) : next.concept_id) : '',
            todaySessionHint: next ? `${next.kind || 'plan'} • D${next.difficulty_1to5 || 3}/5 • ${next.concept_id}` : ''
        };
    }

    async getAlternativeVariant(uid, conceptId, excludeVariantId) {
        const variants = await coachStore.listQuizVariantsByConcept(uid, conceptId);
        const filtered = variants.filter(v => v.variant_id && v.variant_id !== excludeVariantId);
        if (filtered.length > 0) return filtered[Math.floor(Math.random() * filtered.length)];
        if (variants.length > 0) return variants[Math.floor(Math.random() * variants.length)];
        return null;
    }

    async ensureReviewSessions(uid, skillId) {
        const today = todayISO();
        const sessions = await coachStore.listSessions(uid, skillId);
        const existingIds = new Set(sessions.map(s => s.id));

        const errors = await coachStore.listErrorMemory(uid, { limitCount: 50 });
        const due = errors.filter(e => {
            const next = e.nextRepetitionDate;
            if (!next) return false;
            try {
                const iso = typeof next === 'string' ? next.slice(0, 10) : (next.toDate ? next.toDate().toISOString().slice(0, 10) : null);
                return iso && iso <= today;
            } catch {
                return false;
            }
        });

        if (due.length === 0) return { sessions };

        const modules = await coachStore.listModules(uid, skillId);
        const moduleForConcept = (conceptId) => {
            for (const m of modules) {
                if ((m.concept_ids || []).includes(conceptId)) return m.id;
            }
            return null;
        };

        for (const e of due.slice(0, 3)) {
            const conceptId = e.concept_id || e.id;
            if (!conceptId) continue;
            const reviewId = `${skillId}__rev_${conceptId}_${today.replace(/-/g, '')}`;
            if (existingIds.has(reviewId)) continue;
            await coachStore.upsertSession(uid, {
                id: reviewId,
                skill_id: skillId,
                module_id: moduleForConcept(conceptId),
                day: null,
                planned_for: today,
                concept_id: conceptId,
                status: 'planned',
                kind: 'review',
                difficulty_1to5: 2,
                title_i18n: mkI18n(
                    `Review: ${conceptId.replace(/_/g, ' ')}`,
                    `Repaso: ${conceptId.replace(/_/g, ' ')}`,
                    `Révision : ${conceptId.replace(/_/g, ' ')}`
                ),
                content_version: 1
            });
            existingIds.add(reviewId);
        }

        return { sessions: await coachStore.listSessions(uid, skillId) };
    }

    async getNextSession(uid, skillId) {
        const today = todayISO();
        const { sessions } = await this.ensureReviewSessions(uid, skillId);

        const isDue = (s) => String(s.planned_for || '9999-12-31') <= today && s.status !== 'completed';
        const dueRemediation = sessions.find(s => isDue(s) && s.kind === 'remediation');
        if (dueRemediation) return dueRemediation;

        const dueReview = sessions.find(s => isDue(s) && s.kind === 'review');
        if (dueReview) return dueReview;

        return (
            sessions.find(s => isDue(s)) ||
            sessions.find(s => s.status !== 'completed') ||
            null
        );
    }

    async startSession(uid, { settings, skillId, mode = 'blind', baseSessionId = null, excludeVariantId = null } = {}) {
        if (!uid || !skillId) throw new Error('SESSION_CONTEXT_REQUIRED');
        const base = baseSessionId ? await coachStore.getSession(uid, baseSessionId) : await this.getNextSession(uid, skillId);
        if (!base) throw new Error('NO_SESSIONS');

        const conceptId = base.concept_id;
        const maintenance = await coachStore.getMaintenance(uid);
        const cognitiveLoadHigh = Number(maintenance.consecutive_wrong || 0) >= 3;
        const calibrationBias = Number(maintenance.calibration_bias || 0); // + => overconfident, - => underconfident

        const variants = await coachStore.listQuizVariantsByConcept(uid, conceptId);
        const candidates = variants.filter(v => v.variant_id && v.variant_id !== excludeVariantId);
        const pool = candidates.length > 0 ? candidates : variants;
        const sortedByDifficulty = pool.slice().sort((a, b) => Number(a.difficulty_1to5 || 3) - Number(b.difficulty_1to5 || 3));
        let variant = null;
        if (cognitiveLoadHigh || calibrationBias >= 2) {
            variant = sortedByDifficulty[0] || null;
        } else if (calibrationBias <= -2) {
            variant = sortedByDifficulty[sortedByDifficulty.length - 1] || null;
        } else {
            variant = pool[Math.floor(Math.random() * pool.length)] || null;
        }
        if (!variant) throw new Error('NO_VARIANTS');

        const pass = mode === 'assisted' ? 2 : 1;

        await coachStore.upsertSession(uid, {
            ...base,
            status: 'in_progress',
            current_pass: pass,
            active_variant_id: variant.variant_id,
            active_quiz_id: variant.id
        });

        const passLabel = pass === 1 ? 'Pass 1 (Blind)' : 'Pass 2 (Assisted)';
        const passPillTone = pass === 1 ? 'success' : 'warn';

        return {
            runtime: {
                sessionId: base.id,
                skillId,
                conceptId,
                pass,
                quizId: variant.id,
                variant_id: variant.variant_id
            },
            viewData: {
                session: variant,
                sessionTitle: i18n.getContent(variant.decision_prompt_i18n) ? i18n.getContent(variant.decision_prompt_i18n) : conceptId,
                sessionMetaLine: `${conceptId} • ${variant.variant_id}`,
                sessionDurationLabel: '20–30 min',
                sessionDifficultyLabel: `D${variant.difficulty_1to5 || 3}/5`,
                passLabel,
                passPillTone,
                showHint: pass === 2
            }
        };
    }

    shouldShowResources({ isCorrect, confidence, errorCount }) {
        if (!isCorrect) return true;
        if (Number(confidence || 0) <= 2) return true;
        if (Number(errorCount || 0) >= 2) return true;
        return false;
    }

    shouldRequireTeachBack({ pass, isCorrect }) {
        if (!isCorrect) return false;
        if (pass >= 2) return true;
        return false;
    }

    async submitSessionAnswer(uid, { settings, runtime, selectedIndex, confidence, justification }) {
        const quiz = await coachStore.getQuizVariant(uid, runtime.quizId);
        if (!quiz) throw new Error('QUIZ_NOT_FOUND');

        const isCorrect = Number(selectedIndex) === Number(quiz.correct_index);
        const confidenceNum = Number(confidence);

        const overconfidence = !isCorrect && confidenceNum >= 4;
        const underconfidence = isCorrect && confidenceNum <= 2;

        await coachStore.createAttempt(uid, {
            attempt_type: 'session',
            exam_type: quiz.exam_type,
            skill_id: runtime.skillId,
            session_id: runtime.sessionId,
            concept_id: quiz.concept_id,
            variant_id: quiz.variant_id,
            answer_index: Number(selectedIndex),
            confidence_1to5: confidenceNum,
            why_i_thought_this: String(justification || ''),
            language_used: settings?.content_language || 'en',
            is_correct: isCorrect,
            overconfidence,
            underconfidence,
            content_version: quiz.content_version || 1
        });

        const maintenance = await coachStore.getMaintenance(uid);
        const prevStreak = Number(maintenance.streak_days || 0);
        const lastDate = maintenance.last_completed_date || null;
        const prevBias = Number(maintenance.calibration_bias || 0);

        if (!isCorrect) {
            await coachStore.updateErrorMemory(uid, quiz.concept_id, {
                intervals: settings?.spaced_repetition_intervals || [1, 3, 7],
                variantId: quiz.variant_id
            });
            await coachStore.updateMaintenance(uid, { consecutive_wrong: Number(maintenance.consecutive_wrong || 0) + 1 });
        } else {
            await coachStore.updateMaintenance(uid, { consecutive_wrong: 0 });
        }

        let nextBias = prevBias;
        if (overconfidence) nextBias = clamp(prevBias + 1, -5, 5);
        if (underconfidence) nextBias = clamp(prevBias - 1, -5, 5);
        if (nextBias !== prevBias) {
            await coachStore.updateMaintenance(uid, { calibration_bias: nextBias });
        }

        const errorMem = await coachStore.getErrorMemory(uid, quiz.concept_id);
        const showResources = this.shouldShowResources({ isCorrect, confidence: confidenceNum, errorCount: Number(errorMem?.count || 0) });

        const requireTeachBack = this.shouldRequireTeachBack({ pass: runtime.pass, isCorrect });
        const showRetry = runtime.pass === 1 && (!isCorrect || confidenceNum <= 2);
        const showActionPractice = !showRetry;

        const calibration_note_i18n = overconfidence
            ? mkI18n(
                'High confidence + wrong answer. Next sessions will emphasize constraints before speed.',
                'Confianza alta + respuesta incorrecta. Próximas sesiones enfatizan restricciones antes que velocidad.',
                'Confiance élevée + mauvaise réponse. Les prochaines sessions insistent sur les contraintes avant la vitesse.'
            )
            : underconfidence
                ? mkI18n(
                    'Low confidence + correct. Next sessions will gently increase difficulty to build trust.',
                    'Confianza baja + correcto. Próximas sesiones subirán dificultad suavemente para construir confianza.',
                    'Confiance faible + correct. Les prochaines sessions augmenteront légèrement la difficulté pour construire la confiance.'
                )
                : null;

        if (!showRetry && isCorrect) {
            // Complete planned session.
            const streak = coachStore.computeNewStreak(lastDate, prevStreak, true);
            await coachStore.updateMaintenance(uid, { streak_days: streak.streak, last_completed_date: streak.last });
            await coachStore.upsertSession(uid, { id: runtime.sessionId, status: 'completed', completed_at: todayISO(), updatedAt: null });
        }
        if (runtime.pass >= 2 && !isCorrect) {
            // Do not block the roadmap on repeated failures; errors are handled by spaced repetition.
            await coachStore.upsertSession(uid, { id: runtime.sessionId, status: 'completed', completed_at: todayISO(), outcome: 'failed', updatedAt: null });
        }

        const queuedRemediation = async () => {
            if (isCorrect) return;
            if (runtime.pass < 2) return;
            const baseSession = await coachStore.getSession(uid, runtime.sessionId);
            if (!baseSession) return;
            const remediationId = `${runtime.skillId}__rem_${quiz.concept_id}_${todayISO().replace(/-/g, '')}`;
            await coachStore.upsertSession(uid, {
                id: remediationId,
                skill_id: runtime.skillId,
                module_id: baseSession.module_id || null,
                day: null,
                planned_for: addDaysISO(todayISO(), 1),
                concept_id: quiz.concept_id,
                status: 'planned',
                kind: 'remediation',
                content_version: quiz.content_version || 1
            });
        };

        await queuedRemediation();

        return {
            isCorrect,
            explain_i18n: quiz.explain_i18n,
            trap_i18n: quiz.trap_i18n,
            calibration_note_i18n,
            action_practice_i18n: quiz.action_practice_i18n,
            mini_challenge_i18n: quiz.mini_challenge_i18n,
            showRetry,
            requireTeachBack,
            showResources,
            showActionPractice,
            resource_yt: quiz.resources?.yt ? {
                title: i18n.getContent(quiz.resources.yt.title_i18n),
                url: quiz.resources.yt.url,
                why: i18n.getContent(quiz.resources.yt.why_i18n),
                fixes: i18n.getContent(quiz.resources.yt.fixes_i18n)
            } : null,
            resource_web: quiz.resources?.web ? {
                title: i18n.getContent(quiz.resources.web.title_i18n),
                url: quiz.resources.web.url,
                why: i18n.getContent(quiz.resources.web.why_i18n),
                fixes: i18n.getContent(quiz.resources.web.fixes_i18n)
            } : null,
            resource_micro: quiz.resources?.micro ? {
                title: i18n.getContent(quiz.resources.micro.title_i18n),
                why: i18n.getContent(quiz.resources.micro.why_i18n)
            } : null,
            resource_habit: quiz.resources?.habit ? {
                title: i18n.getContent(quiz.resources.habit.title_i18n),
                why: i18n.getContent(quiz.resources.habit.why_i18n)
            } : null
        };
    }
}

export const coachEngine = new CoachEngine();
export { mkI18n };
