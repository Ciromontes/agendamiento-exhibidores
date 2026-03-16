Paso 1 — Obtener el ID de la congregación terranova:


SELECT id, name, slug FROM congregations WHERE slug = 'terranova';
Copia el UUID que aparece en la columna id.

Paso 2 — Crear el primer usuario admin:

'''
INSERT INTO users (name, access_key, user_type, gender, is_active, is_admin, congregation_id)VALUES (  'Admin Terranova',  'terranova-admin-2026',        -- ← esta será tu clave de acceso  'publicador',  'M',  true,  true,  'PEGA-AQUI-EL-UUID-DE-TERRANOVA'  -- ← resultado del paso 1);

'''


Luego entra a https://exhibidores-app.vercel.app/terranova y usa la clave terranova-admin-2026 (o la que hayas puesto).

Alternativa en un solo query (sin copiar el UUID manualmente):

INSERT INTO users (name, access_key, user_type, gender, is_active, is_admin, congregation_id)SELECT  
    'Admin Terranova',  
    'terranova-admin-2026',
     'publicador',  
    'M', 
     true, 
     true, 
     c.idFROM congregations c
    WHERE c.slug = 'terranova';
    
Pega eso tal cual, reemplaza solo la access_key por lo que quieras usar. Si la congregación terranova existe, crea el usuario directamente sin necesidad de copiar UUIDs.

Claude Sonnet 4.6 • 1x