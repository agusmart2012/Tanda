# Tanda

App de rutina para el iPhone. Subís un Excel o un PDF, ves qué toca hoy, marcás las series y abrís un video de la técnica. El coach responde con Grok, si hay una clave de xAI en esta compu.

## Arrancar

Doble clic en `iniciar.cmd`, o:

```
npm install
npm start
```

En esta compu: http://localhost:4173

En el iPhone, Safari abre la dirección que imprime la consola, la que empieza con `http://192.168…`. La rutina queda guardada en el teléfono. Los videos y el coach necesitan esta compu prendida, en la misma red.

Si el iPhone no entra, cuando Windows pregunte dejá que Node.js use las redes privadas.

## Excel o PDF

Tanda detecta el archivo. Sirve cualquiera de estas formas:

- Una hoja por día: `Lunes`, `Martes`, `Jueves`, o `Lunes - Pecho`.
- Una sola hoja con columna `Día`, o el día escrito en la primera columna de cada fila.
- Los días en columnas: `Lunes | Martes | Jueves`, con los ejercicios debajo de cada uno.
- Columnas `Ejercicio`, `Series`, `Reps` o `Repeticiones`, `Peso`, `Descanso`, `Notas`. Los nombres pueden variar.
- Una lista suelta, una línea por ejercicio: `Sentadilla 5x5 100kg`.
- Un CSV separado por coma o punto y coma.
- Un PDF con texto: una página por día, una tabla o líneas como `Sentadilla 5x5 100kg`. Una foto escaneada no se lee.

Si los días no tienen fecha ni nombre de día de la semana (Push, Pull, Pierna), Tanda los rota: hoy es el primero y podés saltear.

Hay un ejemplo en la pantalla de inicio y en `public/sample/rutina-ejemplo.xlsx`.

## Coach

La clave no va al teléfono.

1. Creá una en https://console.x.ai
2. Copiá `.env.example` a `.env`
3. Pegá `XAI_API_KEY=...`
4. Reiniciá Tanda

El modelo es `grok-4.7`.
