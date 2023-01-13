require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const jsonexport = require("jsonexport");

function filterDateIn(startDate, endDate) {
  return (action) => {
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
    headers: [
      "project",
      "member",
      "item",
      "progress",
      "date",
      "done",
      "todos",
      "additionalRate",
    ],
  };

  jsonexport(actions, options, (err, csv) => {
    if (!err) fs.writeFileSync(csvFile, csv);
  });
}

function reduceActionsAsSummary(acc, data) {
  const existingDataIndex = acc.findIndex(
    (d) => d.project === data.project && d.item === data.item
  );
  if (existingDataIndex > -1) {
    const prevDone = (acc[existingDataIndex].done ?? "") + "\n";
    acc[existingDataIndex].done = prevDone + data.done;
  } else {
    acc.push(data);
  }
  return acc;
}

function reduceTodosOnActions(actions, todoData) {
  const existingActionIndex = actions.findIndex(
    (d) => d.project === todoData.project && d.item === todoData.item
  );

  if (existingActionIndex > -1) {
    actions[existingActionIndex].date = todoData.date;
    const prevTodos = (actions[existingActionIndex].todos ?? "") + "\n";
    actions[existingActionIndex].todos = prevTodos + todoData.todos;
  } else {
    actions.push(todoData);
  }
  return actions;
}

const mapTitleAndProgress = (prop) => (data) => {
  const title = `[${data.item}]  진행률 ${
    isNaN(data.progress) ? 0 : data.progress * 100
  }% `;
  console.log("mapTitleAndProgress", prop, data[prop]);
  if (data[prop] && !data[prop]?.includes(title)) {
    data[prop] = title + "\n" + (data[prop] ?? "");
  }
  return data;
};

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
  const actionTypes = ["updateCheckItemStateOnCard" /*, "commentCard" */];
  const key = process.env.key;
  const token = process.env.token;
  if (!key || !token) {
    console.error("key and token have to be given.");
    readline.close();
    return;
  }
  const sufix = `key=${key}&token=${token}`;
  const filterOutLabels = ["canceled", "pending", "done"];

  axios
    .get(`${url}/members/me/boards?fields=name,url&` + sufix)
    .then(async (res) => {
      console.log(
        "all boards",
        res.data.map((x) => x.name)
      );

      const boardData = res.data.filter((b) =>
        ["newmedia.projects", "newmedia.r&d"].includes(b.name.toLowerCase())
      );

      console.log(
        "boardData ",
        boardData.map((x) => x.name)
      );

      const allTodoLists = [];
      const allActionLists = [];
      console.log("=============================");
      console.log("Getting todolists");
      for (const { name, id } of boardData) {
        console.log("fetching all cards of board ", name);
        let todosPerCards = [];
        try {
          const { data: allCards } = await axios.get(
            `${url}/boards/${id}/cards?filter=open&${sufix}`
          );
          console.log("all cards count", allCards.length);
          for (const card of allCards) {
            console.log(
              `==== card.name: ${card.name} labels: ${card.labels
                .map((l) => l.name)
                .join(", ")} ====`
            );
            if (
              !card.idChecklists.length ||
              card.labels.filter((l) =>
                filterOutLabels.includes(l.name.toLowerCase())
              ).length > 0
            )
              continue;

            const { data: list } = await axios.get(
              `${url}/lists/${card.idList}?${sufix}`
            );
            if (list.name.toLowerCase().startsWith("how to use")) continue;

            const { data: members } = await axios.get(
              `${url}/cards/${card.id}/members?${sufix}`
            );

            const { data: checklists } = await axios.get(
              `${url}/cards/${card.id}/checklists?${sufix}`
            );

            const checklistItemsFilter = (c) =>
              !c.name.trim().startsWith("---") &&
              !c.name.trim().startsWith("===");

            const mainCheckLists = checklists
              .filter((cl) => cl.name.toLowerCase().trim().startsWith("main"))
              .map((cl) => ({
                ...cl,
                checkItems: cl.checkItems.filter(checklistItemsFilter),
              }));

            let todoCheckLists = [];
            if (!mainCheckLists.length) {
              console.log(
                "no todo-list found in main checkItems. getting from todo-list..."
              );
            } else {
              console.log(
                mainCheckLists.reduce((a, x) => a + x.checkItems.length, 0),
                " todo-list found in main-list checkItems"
              );
            }
            todoCheckLists = checklists
              .filter((cl) => cl.name.trim().toLowerCase().startsWith("todo"))
              .map((cl) => ({
                ...cl,
                checkItems: cl.checkItems.filter(checklistItemsFilter),
              }));
            if (todoCheckLists.length) {
              console.log(
                todoCheckLists.reduce((a, x) => a + x.checkItems.length, 0),
                " todo-list found in todo-list checkItems"
              );
            }

            const checkListItemsCount = [...mainCheckLists, ...todoCheckLists]
              .map((cl) => cl.checkItems)
              .reduce(
                (acc, checkItems) => ({
                  completed:
                    acc.completed +
                    checkItems.filter((ci) => ci.state === "complete").length,
                  total: acc.total + checkItems.length,
                  additional:
                    acc.additional +
                    checkItems.filter((ci) => ci.name.trim().startsWith("+"))
                      .length,
                }),
                {
                  completed: 0,
                  total: 0,
                  additional: 0,
                }
              );

            const progress =
              Math.round(
                (checkListItemsCount.completed / checkListItemsCount.total) *
                  100
              ) / 100;
            const additionalRate =
              Math.round(
                (checkListItemsCount.additional / checkListItemsCount.total) *
                  100
              ) / 100;

            console.log(
              `\t${card.name} progress: ${progress * 100}% <- ${
                checkListItemsCount.completed
              }/${checkListItemsCount.total} (+${additionalRate}% <- ${
                checkListItemsCount.additional
              })`
            );

            const todoItem = [...mainCheckLists, ...todoCheckLists]
              .map((cl) => cl.checkItems.filter((c) => c.state !== "complete"))
              .reduce(
                (acc, checkItems) => ({
                  ...acc,
                  todos: [...acc.todos, ...checkItems],
                }),
                {
                  board: name,
                  project: list.name,
                  item: card.name,
                  member: members.map((m) => m.fullName).join(", "),
                  date: formatDate(today.toISOString()),
                  progress,
                  additionalRate,
                  todos: [],
                }
              );

            todoItem.todos = todoItem.todos
              .sort((a, b) => (a.name > b.name ? 1 : -1))
              .map((c) => `→ ${c.name}`)
              .join("\n");

            todosPerCards.push(todoItem);
          }
          console.log("todosPerCards", todosPerCards);
          allTodoLists.push({ board: name, data: todosPerCards });
        } catch (e) {
          /* handle error */
          console.error(e);
        }

        console.log("=============================");
        console.log("Getting actions");
        try {
          const { data: actionsFetched } = await axios.get(
            `${url}/boards/${id}/actions?filter=${actionTypes.join(
              ","
            )}&${sufix}`
          );
          const actionLists = [];
          for (const action of (await actionsFetched)
            .filter(filterDateIn(startDate, endDate))
            .filter((a) =>
              a.type === "updateCheckItemStateOnCard"
                ? a.data.checkItem.state === "complete"
                : true
            )) {
            console.log(
              "parsing action of type",
              action.type,
              " and of card ",
              action.data.card.name
            );
            const card = action.data.card;
            const { data: list } = await axios.get(
              `${url}/cards/${card.id}/list?${sufix}`
            );
            const { data: member } = await axios.get(
              `${url}/actions/${action.id}/memberCreator?${sufix}`
            );

            const matchingTodoData = todosPerCards.filter(
              (d) => d.item === card.name
            );

            const progress =
              matchingTodoData.length > 0 ? matchingTodoData[0].progress : 0.0;

            const d = {
              board: name,
              project: list.name,
              member: member.fullName,
              item: card.name,
              progress,
              date: formatDate(action.date),
              done: "✓ " + action.data.checkItem.name,
            };

            actionLists.push(d);
          }
          allActionLists.push({
            board: name,
            data: actionLists,
          });
        } catch (e) {
          /* handle error */
          console.error(e);
          continue;
        }
      }

      console.log("=============================");
      console.log("allTodoLists", allTodoLists);
      console.log("=============================");
      console.log("allActionLists", allActionLists);
      console.log("=============================");
      return [allActionLists, allTodoLists];
    })
    .then(([doneList, todoList]) => {
      const output = [
        ...doneList.map(({ data }) => data),
        ...todoList.map(({ data }) => data),
      ].sort(sortByItemName);
      console.log("writing data to output.csv");
      writeJsonToCsv(output, "./output.csv");

      const doneListReduced = doneList
        .reduce((a, { data }) => [...a, ...data], [])
        .reduce(reduceActionsAsSummary, [])
        .map(mapTitleAndProgress("done"));

      console.log("doneListReduced", doneListReduced);

      const outputOfSummary = [
        ...todoList.map(({ board, data }) =>
          data
            .reduce(reduceTodosOnActions, [
              ...doneListReduced.filter((a) => a.board === board),
            ])
            .map(mapTitleAndProgress("todos"))
        ),
      ].sort(sortByItemName);

      writeJsonToCsv(outputOfSummary, "./output-summary.csv");
      console.log("completed!");
      console.log("=============================");
    })
    .catch(console.error);

  readline.close();
});
