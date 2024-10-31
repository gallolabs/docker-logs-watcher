console.log('start')
async function log(e) {
    process.stderr.write(e.toString() + "\n")
}
process.on('unhandledRejection', async (e) => {
    await log(e)
    //await new Promise(r => setTimeout(r, 200))
    process.exit(1)
})
setTimeout(() => {
    console.log('work')
    setTimeout(async () => {
       throw new Error('Badaboom')
    }, 10000)
}, 10000)
