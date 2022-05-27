require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const jsonexport = require("jsonexport");

function filterDateIn(startDate, endDate) {
  return action => {
    const d = new Date(action.date);
    return d > startDate && d < endDate;
  };
}

function sortByItemName(a, b) {
  if (a.item?.toLowerCase() < b.item?.toLowerCase()) {
    return -1;
  }
  if (a.item?.toLowerCase() > b.item?.toLowerCase()) {
    return 1;
  }
  return 0;
}

function formatDate(dateString) {
  return dateString.substr(0, 10);
}

function writeJsonToCsv(actions, csvFile) {
  const options = {
    headers: ["project", "member", "item", "progress", "date", "done", "todo"],
  };

  jsonexport(actions, options, (err, csv) => {
    if (!err) fs.writeFileSync(csvFile, csv);
  });
}

const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});

readline.question("Input day offset. (default: 7)", (offsetDate = "7") => {
  const today = new Date();
  const offsetDay = offsetDate ? Number(offsetDate) : 7;
  const startDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - offsetDay
  );
  const endDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1
  );
  const todayDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  const url = "https://api.trello.com/1";
  const actionTypes = ["commentCard", "updateCheckItemStateOnCard"];
  const key = process.env.key;
  const token = process.env.token;
  if (!key || !token) {
    console.error("key and token have to be given.");
    readline.close();
    return;
  }
  const sufix = `key=${key}&token=${token}`;

  axios
    .get(`${url}/members/me/boards?fields=name,url&` + sufix)
    .then(async res => {
      console.log("all boards", res.data);

      const boardData = res.data.filter(b =>
        ["newmedia.projects", "newmedia.r&d"].includes(b.name.toLowerCase())
      );

      console.log("boardData ", boardData);

      const allTodoLists = [];
      const allActionLists = [];
      for (const { name, id } of boardData) {
        console.log("fetching all cards of board", name);
        try {
          const { data: allCards } = await axios.get(
            `${url}/boards/${id}/cards?filter=open&${sufix}`
          );
          console.log("all cards count", allCards.length);
          let todosPerCards = [];
          for (const card of allCards) {
            if (!card.idChecklists.length) continue;

            const { data: checklists } = await axios.get(
              `${url}/cards/${card.id}/checklists?${sufix}`
            );
            const matchingCheckLists = checklists.filter(cl =>
              cl.name.toLowerCase().replace(" ", "").startsWith("todo")
            );
            if (!matchingCheckLists.length) continue;
            if (
              matchingCheckLists
                .map(
                  cl =>
                    cl.checkItems.filter(ci => ci.state !== "complete").length >
                    0
                )
                .filter(x => !!x).length === 0
            )
              continue;

            const { data: list } = await axios.get(
              `${url}/lists/${card.idList}?${sufix}`
            );
            const { data: members } = await axios.get(
              `${url}/cards/${card.id}/members?${sufix}`
            );

            const todos = matchingCheckLists
              .map(cl => ({
                project: list.name,
                item: card.name,
                member: members.map(m => m.fullName).join(", "),
                date: formatDate(startDate.toISOString()),
                todo:
                  `${cl.name.replace(/^\s?todo\s?/i, "\n")}` +
                  cl.checkItems
                    .filter(c => c.state !== "complete")
                    .filter(c => !c.name.startsWith("---"))
                    .filter(c => !c.name.startsWith("==="))
                    .map(c => `→ ${c.name}`)
                    .join("\n"),
              }))
              .filter(({ todo }) => !!todo);
            todosPerCards = [
              ...todosPerCards,
              ...todos.filter(t => t.todo.length > 1),
            ];
          }
          console.log("todosPerCards", todosPerCards);
          allTodoLists.push({ board: name, data: todosPerCards });
        } catch (e) {
          /* handle error */
          console.error(e);
        }

        try {
          const { data: actionsFetched } = await axios.get(
            `${url}/boards/${id}/actions?${sufix}`
          );
          const actionLists = [];
          for (const action of (await actionsFetched)
            .filter(filterDateIn(startDate, endDate))
            .filter(a =>
              a.type === "updateCheckItemStateOnCard"
                ? a.data.checkItem.state === "complete"
                : actionTypes.includes(a.type)
            )) {
            const card = action.data.card;
            const { data: list } = await axios.get(
              `${url}/cards/${card.id}/list?${sufix}`
            );
            const { data: checklist } = await axios.get(
              `${url}/cards/${card.id}/checklists?${sufix}`
            );
            const { data: member } = await axios.get(
              `${url}/actions/${action.id}/memberCreator?${sufix}`
            );

            const mainCheckList = checklist.find(c =>
              c.name.toLowerCase().startsWith("main")
            );

            const progress = mainCheckList?.checkItems
              ? Math.round(
                  (mainCheckList.checkItems.filter(c => c.state === "complete")
                    .length /
                    mainCheckList.checkItems.length) *
                    100
                ) / 100
              : undefined;

            const done =
              action.type === "commentCard"
                ? action.data.text
                : "✓ " + action.data.checkItem.name;

            const d = {
              project: list.name,
              member: member.fullName,
              item: card.name,
              date: formatDate(action.date),
              progress,
              done,
            };

            actionLists.push(d);
          }
          allActionLists.push({ board: name, data: actionLists });
        } catch (e) {
          /* handle error */
          console.error(e);
          return null;
        }
      }

      console.log("=============================");
      console.log("allTodoLists", allTodoLists);
      console.log("=============================");
      console.log("allActionLists", allActionLists);
      console.log("=============================");
      return [allActionLists, allTodoLists];
    })
    .then(([actionList, todoList]) => {
      const data = [
        ...actionList.map(({ data }) => data).sort(sortByItemName),
        ...todoList.map(({ data }) => data).sort(sortByItemName),
      ];
      console.log("writing data to output.csv");
      writeJsonToCsv(data, "./output.csv");
      console.log("completed!");
      console.log("=============================");
    })
    .catch(console.error);

  readline.close();
});
